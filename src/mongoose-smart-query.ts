import { Schema, Types, connection } from 'mongoose'

interface LookupConfirmado {
  field: string
  from: string
  project: any
}

type QueryForeign = Record<
  string,
  { collection: string; query: Record<string, any> }
>

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
}

interface TObject {
  [value: string]: any
}

/**
 * Gets a list of possible fields that could allow a $lookup. This list is
 * obtained from the nested fields of the object.
 * @param $project The $project's pipeline that can contains possible $lookup.
 * @returns An array with the fields with a possible $lookup.
 */
export const getListOfPossibleLookups = ($project: any): string[] => {
  let keys: string[] = []
  for (const key in $project) {
    if (typeof $project[key] === 'object') {
      keys.push(key)
      const subkeys = getListOfPossibleLookups($project[key])
      keys = keys.concat(subkeys.map((subkey) => key + '.' + subkey))
    } else if (key.includes('.')) {
      const splited = key.split(/\.(.+)/)
      keys.push(splited[0])
      continue
    } else {
      continue
    }
  }
  return keys
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
    getAllFieldsByDefault = false,
  }: PluginOptions,
) {
  const __protected = stringToQuery(protectedFields)

  schema.statics.smartQuery = async function (
    this: any,
    query: { [key: string]: string } = {},
  ) {
    const {
      pipeline,
      lookupsConfirmados,
    }: { pipeline: any[]; lookupsConfirmados: LookupConfirmado[] } =
      await this.__smartQueryGetPipeline({ ...query })
    const queryEmpresa = query.business
      ? { business: new Types.ObjectId(query.business) }
      : {}
    const dd: any[] = await this.aggregate(pipeline)
    const foraneos = await Promise.all(
      lookupsConfirmados.map((item) => {
        const ids = dd.filter((x) => x[item.field]).map((x) => x[item.field])
        return connection
          .collection(item.from)
          .find({ _id: { $in: ids }, ...queryEmpresa })
          .project(item.project)
          .toArray()
      }),
    )
    for (const index in lookupsConfirmados) {
      const docs = foraneos[index]
      const confirmado = lookupsConfirmados[index]
      for (const doc of dd) {
        doc[confirmado.field] = docs.find((item) =>
          item._id.equals(doc[confirmado.field]),
        )
      }
    }

    return dd
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
  ) {
    const queryEmpresa = query.business
      ? { business: new Types.ObjectId(query.business) }
      : {}
    const originalQuery: { [key: string]: string } = JSON.parse(
      JSON.stringify(query),
    )
    const $page = parseInt(query[pageQueryName]) || 1
    const $limit = parseInt(query[limitQueryName]) || defaultLimit

    const getDefault = async (queryLookup: QueryForeign) => {
      const $localMatch: TObject = {}
      const $foreignMatch: Record<string, any> = {}
      const lookupFinalMatch: Record<
        string,
        { collection: string; $match: Record<string, any> }
      > = {}
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
          : path
          ? $localMatch
          : $foreignMatch
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
      return { $localMatch, $foreignMatch }
    }

    const getMatch = async () => {
      const queryLookup: QueryForeign = {}
      const $queryMatch: Record<string, any> = {}
      const $foreignMatch: Record<string, any> = {}
      const _lookupsMatch: Record<
        string,
        { collection: string; $match: Record<string, any> }
      > = {}
      if (query[queryName] && fieldsForDefaultQuery) {
        const fields = fieldsForDefaultQuery.split(' ')
        const regexParseado = query[queryName].replace(/[()[\\\]*]/g, '.')
        const regex = { $regex: RegExp(regexParseado, 'i') }
        for (const field of fields) {
          const path = schema.path(field)
          if (path) {
            if (!$queryMatch.$or) $queryMatch.$or = []
            $queryMatch.$or.push({ [field]: regex })
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
      const $queryDefault = await getDefault(queryLookup)
      const $or =
        $queryDefault.$localMatch.$or || $queryDefault.$foreignMatch.$or
      if ($or) {
        delete $queryDefault.$localMatch.$or
        delete $queryDefault.$foreignMatch.$or
        if (Array.isArray($queryMatch.$or)) {
          $queryMatch.$or = $queryMatch.$or.concat($or)
        } else if (Array.isArray($foreignMatch.$or)) {
          $foreignMatch.$or = $foreignMatch.$or.concat($or)
        } else {
          $queryMatch.$or = $or
        }
      }
      console.log(
        'query',
        $queryDefault,
        $queryMatch,
        $queryMatch.$or,
        $queryDefault.$localMatch,
        $foreignMatch,
        $queryDefault.$foreignMatch,
      )
      return {
        $queryMatch: {
          ...$queryMatch,
          ...$queryDefault.$localMatch,
        },
        $foreignMatch: {
          ...$foreignMatch,
          ...$queryDefault.$foreignMatch,
        },
      }
    }

    function getFieldsProject(query: TObject): TObject | undefined {
      if (!query[fieldsQueryName] && defaultFields) {
        query[fieldsQueryName] = defaultFields
      }
      let $project = stringToQuery(query[fieldsQueryName])
      $project = removeKeys($project, __protected)
      return $project
    }

    function getSort(): {
      $localSort?: Record<string, number>
      $foreignSort?: Record<string, number>
    } {
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

    const $match = await getMatch()
    const $project = getFieldsProject(query)

    const lookupsConfirmados = getListOfPossibleLookups($project).reduce<
      LookupConfirmado[]
    >((acc, localField) => {
      const path = schema.path(localField)
      if (!path || !path.options.ref) return acc
      const project = Object.keys($project || {}).reduce<Record<string, 1>>(
        (acc, key) => {
          if (key.startsWith(localField + '.')) {
            const [, path] = key.split('.')
            acc[path] = 1
            return acc
          } else if (
            key.startsWith(localField) &&
            typeof $project![localField] === 'object'
          ) {
            return $project![localField]
          } else {
            return acc
          }
        },
        {},
      )
      return acc.concat([
        {
          field: localField,
          from: path.options.ref,
          project,
        },
      ])
    }, [])

    let subPipeline: any[]
    if (forCount) {
      subPipeline = [
        ...(Object.keys($match.$queryMatch).length !== 0
          ? [{ $match: $match.$queryMatch }]
          : []),
        // ...lookups,
        ...getUnwind(),
        // ...(Object.keys($match.$foreignMatch).length !== 0
        //   ? [{ $match: $match.$foreignMatch }]
        //   : []),
        { $count: 'size' },
      ]
    } else {
      const sort = getSort()
      subPipeline = [
        ...(Object.keys($match.$queryMatch).length !== 0
          ? [{ $match: $match.$queryMatch }]
          : []),
        ...(sort.$localSort ? [{ $sort: sort.$localSort }] : []),
        // ...lookups,
        ...getUnwind(),
        // ...(Object.keys($match.$foreignMatch).length !== 0
        //   ? [{ $match: $match.$foreignMatch }]
        //   : []),
        { $skip: ($page - 1) * $limit },
        { $limit },
      ]
      if (
        !(
          (!originalQuery[fieldsQueryName] && getAllFieldsByDefault === true) ||
          query[allFieldsQueryName]?.toString() === 'true'
        )
      ) {
        const tmpProject = { ...$project }
        for (const lookup of lookupsConfirmados) {
          for (const keyP in tmpProject) {
            if (keyP.includes(lookup.field + '.')) delete tmpProject[keyP]
          }
          tmpProject![lookup.field] = 1
        }
        subPipeline.push({ $project: tmpProject })
      } else {
        if (protectedFields) {
          subPipeline.push({ $project: stringToQuery(protectedFields, '0') })
        }
      }
    }
    console.log('subPipeline', subPipeline)
    return { pipeline: subPipeline, $project, lookupsConfirmados }
  }
}
