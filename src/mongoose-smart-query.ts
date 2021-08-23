import { Types } from 'mongoose'

const { ObjectId } = Types

interface PluginOptions {
  /**
   * Fields that should not be included in the query results. Default: `''`.
   */
  protectedFields?: string,
  /**
   * Fields included in the default query results. Default `'_id'`.
   */
  defaultFields?: string,
  /**
   * Default sorting. Default: `'-id'`.
   */
  defaultSort?: string,
  /**
   * Number of documents per query. Default: `20`.
   */
  defaultLimit?: number,
  /**
   * What fields to look for when making a query. Default: `''`.
   */
  fieldsForDefaultQuery?: string,
  /**
   * Key for pagination. Default: `'$page'`.
   */
  pageQueryName?: string,
  /**
   * Key to limit. Default: `'$limit'`.
   */
  limitQueryName?: string,
  /**
   * Key to get specific fields. Default: `'$fields'`.
   */
  fieldsQueryName?: string,
  /**
   * Key for sorting. Default: `$sort`.
   */
  sortQueryName?: string,
  /**
   * Key for search. Default: `'$q'`.
   */
  queryName?: string,
  /**
   * mongodb unwind documents. Default: `'$unwind'`.
   */
  unwindName?: string,
  /**
   * Key for get all fields. Default: `$allFields`.
   */
  allFieldsQueryName?: string,
  /**
   * Get all fields by default
   */
  getAllFieldsByDefault?: boolean,
}

interface TObject { [value: string]: any }

/**
 * Gets a list of possible fields that could allow a $lookup. This list is
 * obtained from the nested fields of the object.
 * @param $project The $project's pipeline that can contains possible $lookup.
 * @returns An array with the fields with a possible $lookup.
 */
export function getListOfPossibleLookups ($project: any) :string[] {
  let keys: string[] = []
  for (const key in $project) {
    if (typeof $project[key] === 'object') {
      keys.push(key)
      const subkeys = getListOfPossibleLookups($project[key])
      keys = keys.concat(subkeys.map(subkey => key + '.' + subkey))
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
export function stringToQuery (query: string = '', value = '1') : object {
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

function parseValue (value: any, instance: string) {
  switch (instance) {
    case 'ObjectID':
      return ObjectId(value)
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
export function removeKeys (initial: TObject, toRemove: TObject) : TObject {
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

export default function (schema: any, {
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
}: PluginOptions) {
  const __protected = stringToQuery(protectedFields)

  schema.statics.smartQuery = function (query: { [key: string]: string } = {}) {
    const pipeline = this.__smartQueryGetPipeline({ ...query })
    return this.aggregate(pipeline)
  }

  schema.statics.smartCount = async function (query: { [key: string]: string } = {}) {
    const pipeline = this.__smartQueryGetPipeline({ ...query }, true)
    const result = await this.aggregate(pipeline)
    return result.length === 0 ? 0 : result[0].size
  }

  schema.statics.__smartQueryGetPipeline =
    function (query: { [key: string]: string }, forCount: boolean = false) {
      const originalQuery = JSON.parse(JSON.stringify(query))
      const $page = parseInt(query[pageQueryName]) || 1
      const $limit = parseInt(query[limitQueryName]) || defaultLimit

      function getDefault () {
        const $localMatch: TObject = {}
        const $foreignMatch: Record<string, any> = {}
        for (const key in query) {
          const path = schema.path(key)
          const $toAdd = path ? $localMatch : $foreignMatch
          if (!path && !key.includes('.')) { continue }
          const queryRegex = /(?:\{(\$?[\w ]+)\})?([^{}\n]+)/g
          let match
          const values = []
          if (typeof query[key] === 'string') {
            while ((match = queryRegex.exec(query[key])) !== null) {
              values.push([match[0], match[1], match[2]])
            }
            for (const [, operator, value] of values) {
              switch (operator) {
                case '$exists':
                  $toAdd[key] = { $exists: value !== 'false' }
                  break
                case '$includes':
                  $toAdd[key] = { $regex: RegExp(value.replace(/[^\w]/g, '.'), 'i') }
                  break
                default: {
                  const parsedValue = parseValue(value, path?.instance)
                  if (operator) {
                    if (typeof $toAdd[key] === 'object') {
                      $toAdd[key][operator] = parsedValue
                    } else {
                      $toAdd[key] = { [operator]: parsedValue }
                    }
                  } else {
                    if (typeof value === 'string' && value.includes('$exists')) {
                      $toAdd[key] = { $exists: true, $ne: [] }
                    } else {
                      $toAdd[key] = parsedValue
                    }
                  }
                  break
                }
              }
            }
          } else {
            $toAdd[key] = parseValue(query[key], path?.instance)
          }
        }
        return { $localMatch, $foreignMatch }
      }

      function getMatch () {
        const $queryMatch: Record<string, any> = {}
        const $foreignMatch: Record<string, any> = {}
        if (query[queryName] && fieldsForDefaultQuery) {
          const fields = fieldsForDefaultQuery.split(' ')
          const regex = { $regex: RegExp(query[queryName].replace(/[()[\]]/g, '.'), 'i') }
          for (const field of fields) {
            const path = !!schema.path(field)
            if (path) {
              if (!$foreignMatch.$or) { $foreignMatch.$or = [] }
              $foreignMatch.$or.push({ [`${field}`]: regex })
            } else {
              if (!$foreignMatch.$or) { $foreignMatch.$or = [] }
              $foreignMatch.$or.push({ [`${field}`]: regex })
            }
          }
        }
        const $queryDefault = getDefault()
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

      function getFieldsProject (query: TObject) :TObject | undefined {
        if (!query[fieldsQueryName] && defaultFields) {
          query[fieldsQueryName] = defaultFields
        }
        let $project = stringToQuery(query[fieldsQueryName])
        $project = removeKeys($project, __protected)
        return $project
      }

      function getSort (): {
        $localSort?: Record<string, number>;
        $foreignSort?: Record<string, number>;
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
          $localSort: Object.keys($localSort).length !== 0
            ? $localSort
            : undefined,
          $foreignSort: Object.keys($foreignSort).length !== 0
            ? $foreignSort
            : undefined,
        }
      }

      function getLookups (project: any) {
        const lookups: [any?] = []
        getListOfPossibleLookups(project).forEach(localField => {
          const path = schema.path(localField)
          if (!path || !path.options.ref) return
          const { ref: from } = path.options
          lookups.push({
            $lookup: { from, localField, foreignField: '_id', as: localField },
          }, {
            $unwind: { path: `$${localField}`, preserveNullAndEmptyArrays: true },
          })
        })
        return lookups
      }

      function getUnwind () {
        if (!query[unwindName]) return []
        return [
          {
            $unwind: {
              path: `$${query[unwindName]}`, preserveNullAndEmptyArrays: true,
            },
          },
        ]
      }

      const $match = getMatch()
      const $project = getFieldsProject(query)
      const lookups = getLookups($project)
      let subPipeline: any[]
      if (forCount) {
        subPipeline = [
          ...Object.keys($match.$queryMatch).length !== 0
            ? [{ $match: $match.$queryMatch }]
            : [],
          ...lookups,
          ...getUnwind(),
          ...Object.keys($match.$foreignMatch).length !== 0
            ? [{ $match: $match.$foreignMatch }]
            : [],
          { $count: 'size' },
        ]
      } else {
        const sort = getSort()
        subPipeline = [
          ...Object.keys($match.$queryMatch).length !== 0
            ? [{ $match: $match.$queryMatch }]
            : [],
          ...sort.$localSort
            ? [{ $sort: sort.$localSort }]
            : [],
          ...lookups,
          ...getUnwind(),
          ...Object.keys($match.$foreignMatch).length !== 0
            ? [{ $match: $match.$foreignMatch }]
            : [],
          { $skip: ($page - 1) * $limit },
          { $limit },
        ]
        if (!((!originalQuery[fieldsQueryName] && getAllFieldsByDefault === true) ||
          query[allFieldsQueryName]?.toString() === 'true')) {
          subPipeline.push({ $project })
        } else {
          if (protectedFields) {
            subPipeline.push({ $project: stringToQuery(protectedFields, '0') })
          }
        }
      }
      return subPipeline
    }
}
