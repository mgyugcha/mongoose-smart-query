import { Schema, Types, connection } from 'mongoose'

interface LookupConfirmado {
  field: string
  from: string
  project: any
}

type QueryForeign = Record<
  string,
  { collection: string; $match: Record<string, any> }
>

interface SmartQueryOptions {
  prePipeline?: any[]
  useFacet?: boolean
}

interface PluginOptions {
  /**
   * Fields that should not be included in the query results. Default: `''`.
   */
  protectedFields?: string
  /**
   * Fields included in the default query results. Default `'_id'`.
   */
  defaultFields?: string
  /**
   * Default sorting. Default: `'-id'`.
   */
  defaultSort?: string
  /**
   * Number of documents per query. Default: `20`.
   */
  defaultLimit?: number
  /**
   * What fields to look for when making a query. Default: `''`.
   * @deprecated Use `defaultFields` instead.
   */
  fieldsForDefaultQuery?: string
  /**
   * Key for pagination. Default: `'$page'`.
   */
  pageQueryName?: string
  /**
   * Key to limit. Default: `'$limit'`.
   */
  limitQueryName?: string
  /**
   * Key to get specific fields. Default: `'$fields'`.
   */
  fieldsQueryName?: string
  /**
   * Key for sorting. Default: `$sort`.
   */
  sortQueryName?: string
  /**
   * Key for search. Default: `'$q'`.
   * @deprecated `queryName` is deprecated, use `searchQueryName` instead.
   */
  queryName?: string
  /**
   * mongodb unwind documents. Default: `'$unwind'`.
   */
  unwindName?: string
  /**
   * Key for get all fields. Default: `$allFields`.
   */
  allFieldsQueryName?: string
  /**
   * Get all fields by default
   */
  getAllFieldsByDefault?: boolean
  /**
   * Fields to search by default
   */
  fieldsForDefaultSearch?: string[] | string
  /**
   * Key for search. Default: `'$search'`.
   */
  searchQueryName?: string
}

interface TObject {
  [value: string]: any
}

const reemplazarSubdoc = (data: TObject, path: string, reemplazo?: unknown) => {
  if (!reemplazo) return
  let tmp = data
  const campos = path.split('.')
  campos.forEach((campo, index) => {
    if (index === campos.length - 1) {
      if (tmp?.[campo]) tmp[campo] = reemplazo
    } else {
      tmp = tmp?.[campo]
    }
  })
}

const getCampo = (data: TObject, path: string) => {
  let tmp = data
  const campos = path.split('.')
  campos.forEach((campo) => (tmp = tmp?.[campo]))
  return tmp
}

/**
 * Converts a string to object. Example:
 * 'name age friends { name }' => { name: 1, age: 1, friends: { name: 1 } }
 * @param query String to convert to object.
 * @returns The resulting object.
 */
export function stringToQuery(query: string = '', value = '1'): object {
  const regex = /(})(?!$| *})|([\w.]+)(?= *{)|([\w.]+)(?=$| *})|([\w.]+)/g
  const preJSON = query.replace(regex, (match, p1, p2, p3, p4) => {
    if (p1) {
      return p1 + ','
    } else if (p2) {
      return `"${p2}":`
    } else if (p3) {
      return `"${p3}": ${value}`
    } else if (p4) {
      return `"${p4}": ${value},`
    } else {
      return ''
    }
  })
  return JSON.parse(`{ ${preJSON} }`)
}

function parseValue(value: any, instance: string) {
  switch (instance) {
    case 'ObjectID':
    case 'ObjectId':
      return new Types.ObjectId(value)
    case 'Date':
      return new Date(value)
    case 'Number':
      return Number(value)
    case 'Boolean':
      return typeof value === 'boolean' ? value : value === 'true'
    default:
      return value
  }
}

/**
 * Remove the keys from the initial object. If after this process the property
 * is empty it is removed
 * @param initial The main object
 * @param toRemove The object with the keys to remove
 * @returns The object without the keys
 */
export function removeKeys(initial: TObject, toRemove: TObject): TObject {
  const principal = { ...initial }
  for (const key in toRemove) {
    if (!principal[key]) continue
    if (typeof toRemove[key] === 'object') {
      principal[key] = removeKeys(principal[key], toRemove[key])
      if (Object.keys(principal[key]).length === 0) delete principal[key]
    } else {
      delete principal[key]
    }
  }
  return principal
}

export default function (
  schema: Schema,
  {
    protectedFields = '',
    defaultFields = '_id',
    defaultSort = '-_id',
    defaultLimit = 20,
    pageQueryName = '$page',
    limitQueryName = '$limit',
    fieldsQueryName = '$fields',
    sortQueryName = '$sort',
    queryName = '$q',
    unwindName = '$unwind',
    fieldsForDefaultQuery = '',
    allFieldsQueryName = '$getAllFields',
    fieldsForDefaultSearch = [],
    searchQueryName = '$search',
    getAllFieldsByDefault = false,
  }: PluginOptions,
) {
  const __protected = stringToQuery(protectedFields)

  /**
   * Gets a list of possible fields that could allow a $lookup. This list is
   * obtained from the nested fields of the object.
   * @param $project The $project's pipeline that can contains possible $lookup.
   * @returns An array with the fields with a possible $lookup.
   */
  const getListOfPossibleLookups = (
    $project: TObject = {},
    padre = '',
  ): LookupConfirmado[] => {
    padre &&= padre + '.'
    const confirmados: LookupConfirmado[] = []
    const addCampos = (field: string, from: string, project: TObject) => {
      const existente = confirmados.find((item) => item.field === field)
      if (existente) {
        existente.project = { ...existente.project, ...project }
      } else {
        confirmados.push({ field, from, project })
      }
    }

    for (const key in $project) {
      if (typeof $project[key] === 'object') {
        const path = schema.path(padre + key)
        if (path && path.options.ref) {
          addCampos(padre + key, path.options.ref, $project[key])
        } else {
          const subkeys = getListOfPossibleLookups($project[key], padre + key)
          subkeys.forEach((result) => {
            addCampos(result.field, result.from, result.project)
          })
        }
      } else if (key.includes('.') || padre) {
        const splited = key.split(/\.(.+)/)
        const path = schema.path(padre + splited[0])
        if (path && path.options.ref) {
          const existente = confirmados.find(
            (item) => item.field === splited[0],
          )
          if (existente) {
            existente.project[splited[1]] = 1
          } else {
            confirmados.push({
              field: splited[0],
              from: path.options.ref,
              project: { [splited[1]]: 1 },
            })
          }
        }
        continue
      } else {
        continue
      }
    }
    return confirmados
  }

  const asignarLookups = (
    lookup: TObject = {},
    confirmados: LookupConfirmado[],
  ) => {
    for (const confirmado of confirmados) {
      if (confirmado.field.includes('.') || lookup[confirmado.field]) {
        reemplazarSubdoc(lookup, confirmado.field, 1)
      } else {
        for (const key in lookup) {
          if (key.startsWith(confirmado.field + '.')) {
            delete lookup[key]
            lookup[confirmado.field] = 1
          }
        }
      }
    }
  }

  schema.statics.smartQuery = async function (
    this: any,
    query: { [key: string]: string } = {},
    options: SmartQueryOptions = {},
  ) {
    const { prePipeline = [], useFacet = false } = options
    const {
      pipeline,
      lookupsConfirmados,
    }: { pipeline: any[]; lookupsConfirmados: LookupConfirmado[] } =
      await this.__smartQueryGetPipeline(
        { ...query },
        false,
        prePipeline,
        useFacet,
      )
    const queryEmpresa = query.business
      ? { business: new Types.ObjectId(query.business) }
      : {}
    const dd: any[] = await this.aggregate(pipeline)

    let docs: any[] = dd
    let pagination: any = null

    if (useFacet) {
      const result = dd[0] || {}
      docs = result.data || []
      const total = result.metadata?.[0]?.total || 0
      const page = parseInt(query[pageQueryName]) || 1
      const limit = parseInt(query[limitQueryName]) || defaultLimit
      const pages = Math.ceil(total / limit)
      pagination = { total, page, pages, limit }
    }

    const foraneos = await Promise.all(
      lookupsConfirmados.map((item) => {
        const ids = docs.reduce((acc, val) => {
          const valor = getCampo(val, item.field)
          if (valor) acc.push(valor)
          return acc
        }, [])
        return ids.length !== 0
          ? connection
              .collection(item.from)
              .find({ _id: { $in: ids }, ...queryEmpresa })
              .project(item.project)
              .toArray()
          : []
      }),
    )
    for (const index in lookupsConfirmados) {
      const docsEx = foraneos[index]
      const confirmado = lookupsConfirmados[index]
      for (const doc of docs) {
        const keyPrincipal = getCampo(doc, confirmado.field)
        if (keyPrincipal)
          reemplazarSubdoc(
            doc,
            confirmado.field,
            docsEx.find((item) => item._id.equals(keyPrincipal)),
          )
      }
    }

    if (useFacet) {
      return { data: docs, pagination }
    }

    return docs
  }

  schema.statics.smartCount = async function (
    this: any,
    query: { [key: string]: string } = {},
  ) {
    const { pipeline } = await this.__smartQueryGetPipeline({ ...query }, true)
    const result = await this.aggregate(pipeline)
    return result.length === 0 ? 0 : result[0].size
  }

  schema.statics.__smartQueryGetPipeline = async function (
    query: { [key: string]: string },
    forCount = false,
    prePipeline: any[] = [],
    useFacet = false,
  ) {
    const hasTextIndex = this.schema.indexes().some(([index]) => {
      return Object.values(index).includes('text')
    })
    const queryEmpresa = query.business
      ? { business: new Types.ObjectId(query.business) }
      : {}
    const originalQuery: { [key: string]: string } = JSON.parse(
      JSON.stringify(query),
    )
    const $page = parseInt(query[pageQueryName]) || 1
    const $limit = parseInt(query[limitQueryName]) || defaultLimit

    const getDefault = async () => {
      const $localMatch: TObject = {}
      const lookupFinalMatch: QueryForeign = {}
      const $or: unknown[] = []
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
          const $filtroActual: Record<string, any> = {}
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
      let $queryMatch: Record<string, any> = {}
      const _lookupsMatch: QueryForeign = {}
      let usingTextSearch = false

      if (hasTextIndex && query[queryName]) {
        $queryMatch = { $text: { $search: query[queryName] } }
        usingTextSearch = true
      } else if (query[queryName] && fieldsForDefaultQuery) {
        const fields = fieldsForDefaultQuery.split(' ')
        const regexParseado = query[queryName]
          .replace(/[()[\\\]]/g, '.')
          .replace(/[+]/g, '\\+')
          .replace(/[*]/g, '\\*')
        const subWordArray = regexParseado.split(' ')
        const regex = { $regex: RegExp(regexParseado, 'i') }
        for (const field of fields) {
          const path = schema.path(field)
          if (path) {
            if (!$queryMatch.$or) $queryMatch.$or = []
            if (subWordArray.length === 0) {
              $queryMatch.$or.push({ [field]: regex })
            } else {
              $queryMatch.$or.push({
                $and: subWordArray.map((word) => ({
                  [field]: { $regex: RegExp(word, 'i') },
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
                _lookupsMatch[subField].$match.$or.push({ [busqueda]: regex })
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
              if (idsDocs.length)
                $queryMatch.$or.push({ [key]: { $in: idsDocs } })
            }),
          )
        }
      }

      if (query[searchQueryName] && fieldsForDefaultSearch.length !== 0) {
        const keysForSearch = Array.isArray(fieldsForDefaultSearch)
          ? fieldsForDefaultSearch
          : [fieldsForDefaultSearch]
        const buscador = keysForSearch.map((item) => ({
          [item]: {
            $regex: query[searchQueryName]
              .toLowerCase()
              .replace(/[^a-z0-9]/g, ''),
          },
        }))
        if (buscador.length === 1) {
          $queryMatch = buscador[0]
        } else {
          $queryMatch.$or = buscador
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

    function getFieldsProject(query: TObject): TObject | undefined {
      if (!query[fieldsQueryName] && defaultFields) {
        query[fieldsQueryName] = defaultFields
      }
      let $project = stringToQuery(query[fieldsQueryName])
      $project = removeKeys($project, __protected)
      return $project
    }

    const getUnwind = () => {
      return !query[unwindName]
        ? []
        : [
            {
              $unwind: {
                path: `$${query[unwindName]}`,
                preserveNullAndEmptyArrays: true,
              },
            },
          ]
    }

    const { match: $match, usingTextSearch } = await getMatch()
    const $project = getFieldsProject(query)

    const lookupsConfirmados = getListOfPossibleLookups($project)

    // Construct pipeline: Match -> PrePipeline -> (Count/Facet/Data)
    // Indexes are used best if Match is first.
    let pipeline: any[] = []

    if (Object.keys($match).length !== 0) {
      pipeline.push({ $match })
    }

    pipeline.push(...prePipeline)

    if (forCount) {
      pipeline.push(...getUnwind(), { $count: 'size' })
    } else {
      const getSort = (): {
        $localSort?: Record<string, any>
        $foreignSort?: Record<string, number>
      } => {
        if (usingTextSearch) {
          return { $localSort: { score: { $meta: 'textScore' } } }
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
      const projectStage: any[] = []

      if (
        !(
          (!originalQuery[fieldsQueryName] && getAllFieldsByDefault === true) ||
          query[allFieldsQueryName]?.toString() === 'true'
        )
      ) {
        asignarLookups($project, lookupsConfirmados)
        const finalProject = { ...$project }
        if (usingTextSearch) {
          finalProject.score = { $meta: 'textScore' }
        }
        projectStage.push({ $project: finalProject })
      } else {
        if (protectedFields) {
          projectStage.push({ $project: stringToQuery(protectedFields, '0') })
        }
        if (usingTextSearch) {
          projectStage.push({ $addFields: { score: { $meta: 'textScore' } } })
        }
      }

      if (useFacet) {
        pipeline.push({
          $facet: {
            metadata: [{ $count: 'total' }],
            data: [
              ...(sort.$localSort ? [{ $sort: sort.$localSort }] : []),
              ...getUnwind(),
              { $skip: ($page - 1) * $limit },
              { $limit },
              ...projectStage,
            ],
          },
        })
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
