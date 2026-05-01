import {
  FilterQuery,
  Model,
  PipelineStage,
  Schema,
  Types,
  connection,
} from 'mongoose'
import type { PluginOptions, QueryForeign, TObject } from '../types'
import {
  getListOfPossibleLookups,
  asignarLookups,
  normalizeSearchText,
  stringToQuery,
  parseValue,
  removeKeys,
} from '../utils'

export function createSmartQueryGetPipeline(
  schema: Schema,
  options: PluginOptions,
) {
  const {
    protectedFields = '',
    defaultFields = '_id',
    defaultSort = '-_id',
    defaultLimit = 20,
    fieldsForDefaultQuery = '',
    pageQueryName = '$page',
    limitQueryName = '$limit',
    fieldsQueryName = '$fields',
    sortQueryName = '$sort',
    queryName = '$q',
    textQueryName = '$text',
    unwindName = '$unwind',
    allFieldsQueryName = '$getAllFields',
    normalizeSearchQuery = false,
  } = options

  const __protected = stringToQuery(protectedFields)

  return async function <T>(
    this: Model<T>,
    query: { [key: string]: string },
    forCount = false,
    prePipeline: PipelineStage[] = [],
    typesenseIds?: string[],
  ) {
    const hasTextIndex = schema.indexes().some(([index]) => {
      return Object.values(index as Record<string, string>).includes('text')
    })
    const queryEmpresa = query.business
      ? { business: new Types.ObjectId(query.business) }
      : {}
    const $page = parseInt(query[pageQueryName]) || 1
    const $limit = parseInt(query[limitQueryName]) || defaultLimit

    const getDefault = async () => {
      const $localMatch: TObject = {}
      const lookupFinalMatch: QueryForeign = {}
      const $or: FilterQuery<object>[] = []
      for (const keyInicial in query) {
        const path = schema.path(keyInicial)
        if (!path && !keyInicial.includes('.')) continue
        let key = keyInicial
        let lookupKey: string | undefined
        const valorQuery = query[key]
        if (keyInicial.includes('.')) {
          const [keyForanea, subKey] = keyInicial.split('.')
          const foraneaKey = schema.path(keyForanea)
          if (foraneaKey && foraneaKey.options.ref) {
            key = subKey
            lookupKey = keyForanea
            lookupFinalMatch[lookupKey] = {
              collection: foraneaKey.options.ref,
              $match: {},
            }
          }
        }
        const $toAdd = lookupKey
          ? lookupFinalMatch[lookupKey].$match
          : $localMatch
        const queryRegex = /(?:\{(\$?[\w ]+)\})?([^{}\n]+)/g
        let match
        const values: Array<[string, string, string]> = []
        if (typeof valorQuery === 'string') {
          const $filtroActual: FilterQuery<object> = {}
          let valor = valorQuery
          const tieneOperadorOr = valor.startsWith('{$or}')
          if (tieneOperadorOr) valor = valor.replace('{$or}', '')
          while ((match = queryRegex.exec(valor)) !== null) {
            values.push([match[0], match[1], match[2]])
          }
          for (const [, operator, value] of values) {
            switch (operator) {
              case '$exists':
                $filtroActual[key] = { $exists: value !== 'false' }
                break
              case '$includes':
                $filtroActual[key] = {
                  $regex: RegExp(value.replace(/[^\w]/g, '.'), 'i'),
                }
                break
              case '$in':
              case '$nin': {
                const findin = value
                  .split(',')
                  .map((item) => parseValue(item.trim(), path?.instance))
                $filtroActual[key] = { [operator]: findin }
                break
              }
              default: {
                const parsedValue = parseValue(value, path?.instance)
                if (operator) {
                  if (typeof $filtroActual[key] === 'object') {
                    $filtroActual[key][operator] = parsedValue
                  } else {
                    $filtroActual[key] = { [operator]: parsedValue }
                  }
                } else {
                  if (typeof value === 'string' && value.includes('$exists')) {
                    $filtroActual[key] = { $exists: true, $ne: [] }
                  } else {
                    $filtroActual[key] = parsedValue
                  }
                }
                break
              }
            }
          }
          if (tieneOperadorOr) {
            $or.push($filtroActual)
          } else {
            Object.assign($toAdd, $filtroActual)
          }
        } else {
          $toAdd[key] = parseValue(valorQuery, path?.instance)
        }
      }
      if ($or.length !== 0) $localMatch.$or = $or
      if (Object.keys(lookupFinalMatch).length !== 0) {
        await Promise.all(
          Object.entries(lookupFinalMatch).map(async ([key, value]) => {
            const docs = await connection
              .collection(value.collection)
              .find({ ...value.$match, ...queryEmpresa })
              .project({ _id: 1 })
              .toArray()
            $localMatch[key] = { $in: docs.map((item) => item._id) }
          }),
        )
      }
      return $localMatch
    }

    const getMatch = async () => {
      if (typesenseIds) {
        return {
          match: {
            _id: { $in: typesenseIds.map((id) => new Types.ObjectId(id)) },
          },
          usingTextSearch: false,
        }
      }

      let $queryMatch: FilterQuery<object> = {}
      const _lookupsMatch: QueryForeign = {}
      let usingTextSearch = false

      if (hasTextIndex && query[textQueryName]) {
        $queryMatch = { $text: { $search: query[textQueryName] } }
        usingTextSearch = true
      } else if (query[queryName] && fieldsForDefaultQuery) {
        const fields = fieldsForDefaultQuery.split(' ')
        const searchValue = normalizeSearchQuery
          ? normalizeSearchText(query[queryName])
          : query[queryName]
        const regexParseado = searchValue
          .replace(/[()[\\\]]/g, '.')
          .replace(/[+]/g, '\\+')
          .replace(/[*]/g, '\\*')
        const subWordArray = regexParseado.split(' ')
        const regexFlags = normalizeSearchQuery ? '' : 'i'
        const regex = { $regex: RegExp(regexParseado, regexFlags) }

        for (const field of fields) {
          const path = schema.path(field)
          if (path) {
            if (!$queryMatch.$or) $queryMatch.$or = []
            if (subWordArray.length <= 1) {
              $queryMatch.$or.push({ [field]: regex })
            } else {
              $queryMatch.$or.push({
                $and: subWordArray.map((word) => ({
                  [field]: { $regex: RegExp(word, regexFlags) },
                })),
              })
            }
          } else if (field.includes('.')) {
            const [subField, busqueda] = field.split('.')
            const subpath = schema.path(subField)
            if (subpath && subpath.options.ref) {
              if (!_lookupsMatch[subField])
                _lookupsMatch[subField] = {
                  collection: subpath.options.ref,
                  $match: { $or: [{ [busqueda]: regex }] },
                }
              else
                _lookupsMatch[subField].$match.$or!.push({ [busqueda]: regex })
            }
          }
        }

        if (Object.keys(_lookupsMatch).length !== 0) {
          await Promise.all(
            Object.entries(_lookupsMatch).map(async ([key, value]) => {
              const docs = await connection
                .collection(value.collection)
                .find({ ...value.$match, ...queryEmpresa })
                .project({ _id: 1 })
                .toArray()
              const idsDocs = docs.map((item) => item._id)
              if (idsDocs.length) {
                if (!$queryMatch.$or) $queryMatch.$or = []
                $queryMatch.$or!.push({ [key]: { $in: idsDocs } })
              }
            }),
          )
        }
      }

      const $queryDefault = await getDefault()
      const $or = $queryDefault.$or
      if ($or) {
        delete $queryDefault.$or
        if (Array.isArray($queryMatch.$or)) {
          $queryMatch.$or = $queryMatch.$or.concat($or)
        } else {
          $queryMatch.$or = $or
        }
      }
      return { match: { ...$queryDefault, ...$queryMatch }, usingTextSearch }
    }

    function getFieldsProject(query: TObject): TObject {
      if (!query[fieldsQueryName] && defaultFields) {
        query[fieldsQueryName] = defaultFields
      }
      let $project = stringToQuery(query[fieldsQueryName])
      $project = removeKeys($project, __protected)
      return $project
    }

    const getUnwind = (): PipelineStage[] => {
      return !query[unwindName]
        ? []
        : [
            {
              $unwind: {
                path: `$${query[unwindName]}`,
                preserveNullAndEmptyArrays: true,
              },
            } as PipelineStage,
          ]
    }

    const { match: $match, usingTextSearch } = await getMatch()
    const $project = getFieldsProject(query)

    const lookupsConfirmados = getListOfPossibleLookups(schema, $project)

    const pipeline: PipelineStage[] = []

    if (Object.keys($match).length !== 0) {
      pipeline.push({ $match } as PipelineStage)
    }

    pipeline.push(...prePipeline)

    if (forCount) {
      pipeline.push(...getUnwind(), { $count: 'size' } as PipelineStage)
    } else {
      const getSort = (): {
        $localSort?: Record<string, any>
        $foreignSort?: Record<string, number>
      } => {
        if (usingTextSearch) {
          return { $localSort: { score: { $meta: 'textScore' }, _id: -1 } }
        }
        if (!query[sortQueryName]) {
          if (!defaultSort) return {}
          query[sortQueryName] = defaultSort
        }
        const regex = /(-)?([\w.]+)/g
        const $localSort: Record<string, number> = {}
        const $foreignSort: Record<string, number> = {}
        let matched
        while ((matched = regex.exec(query[sortQueryName])) !== null) {
          const order = matched[1]
          const localfield = matched[2]
          const path = !!schema.path(localfield)
          if (path) {
            $localSort[localfield] = order ? -1 : 1
          } else {
            $foreignSort[localfield] = order ? -1 : 1
          }
        }
        return {
          $localSort:
            Object.keys($localSort).length !== 0 ? $localSort : undefined,
          $foreignSort:
            Object.keys($foreignSort).length !== 0 ? $foreignSort : undefined,
        }
      }

      const sort = getSort()
      const projectStage: PipelineStage[] = []

      if (!(query[allFieldsQueryName]?.toString() === 'true')) {
        asignarLookups($project, lookupsConfirmados)
        const finalProject = { ...$project }
        if (usingTextSearch) {
          finalProject.score = { $meta: 'textScore' }
        }
        projectStage.push({ $project: finalProject } as PipelineStage)
      } else {
        if (protectedFields) {
          projectStage.push({
            $project: stringToQuery(protectedFields, '0'),
          } as PipelineStage)
        }
        if (usingTextSearch) {
          projectStage.push({
            $addFields: { score: { $meta: 'textScore' } },
          } as PipelineStage)
        }
      }

      if (typesenseIds) {
        pipeline.push(
          ...getUnwind(),
          {
            $addFields: {
              __order: {
                $indexOfArray: [
                  typesenseIds.map((id) => new Types.ObjectId(id)),
                  '$_id',
                ],
              },
            },
          } as PipelineStage,
          { $sort: { __order: 1 } } as PipelineStage,
          ...projectStage,
        )
      } else {
        pipeline.push(
          ...(sort.$localSort ? [{ $sort: sort.$localSort }] : []),
          ...getUnwind(),
          { $skip: ($page - 1) * $limit },
          { $limit },
          ...projectStage,
        )
      }
    }
    return { pipeline, lookupsConfirmados }
  }
}
