import mongoose from 'mongoose'

const { ObjectId } = mongoose.Types

interface PluginOptions {
  protectedFields?: string,
  defaultFields?: string,
  defaultSort?: string,
  defaultLimit?: number,
  fieldsForDefaultQuery?: string,
  // query names
  pageQueryName?: string,
  limitQueryName?: string,
  fieldsQueryName?: string,
  sortQueryName?: string,
  queryName?: string,
  unwindName?: string,
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
    if (typeof $project[key] !== 'object') continue
    keys.push(key)
    const subkeys = getListOfPossibleLookups($project[key])
    keys = keys.concat(subkeys.map(subkey => key + '.' + subkey))
  }
  return keys
}

/**
 * Converts a string to object. Example:
 * 'name age friends { name }' => { name: 1, age: 1, friends: { name: 1 } }
 * @param query String to convert to object.
 * @returns The resulting object.
 */
export function stringToQuery (query: string = '') : object {
  const regex = /(})(?!$| *})|([\w.]+)(?= *{)|([\w.]+)(?=$| *})|([\w.]+)/g
  const preJSON = query.replace(regex, (match, p1, p2, p3, p4) => {
    if (p1) {
      return p1 + ','
    } else if (p2) {
      return `"${p2}":`
    } else if (p3) {
      return `"${p3}": 1`
    } else if (p4) {
      return `"${p4}": 1,`
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
  protectedFields = undefined,
  defaultFields = '-id',
  defaultSort = '-_id',
  defaultLimit = 20,
  pageQueryName = '$page',
  limitQueryName = '$limit',
  fieldsQueryName = '$fields',
  sortQueryName = '$sort',
  queryName = '$q',
  unwindName = '$unwind',
  fieldsForDefaultQuery = '',
}: PluginOptions) {
  const __protected = stringToQuery(protectedFields)

  schema.statics.smartQuery = function (query: any = {}) {
    const pipeline = this.__smartQueryGetPipeline(Object.assign({}, query))
    return this.aggregate(pipeline)
  }

  schema.statics.__smartQueryGetPipeline = function (query: any, forCount = false) {
    const $page = parseInt(query[pageQueryName]) || 1
    delete query[pageQueryName]
    const $limit = parseInt(query[limitQueryName]) || defaultLimit
    delete query[limitQueryName]

    function getDefault () {
      const $match: TObject = {}
      for (const key in query) {
        const path = schema.path(key)
        if (!path && !key.includes('.')) { continue }
        const value = query[key]
        if (typeof value === 'string' && value.includes('$exists')) {
          $match[key] = { $exists: true, $ne: [] }
        } else {
          $match[key] = parseValue(value, path?.instance)
        }
      }
      return $match
    }

    function getMatch () :[any?] {
      let $queryMatch = {}
      if (query[queryName] && fieldsForDefaultQuery) {
        const fields = fieldsForDefaultQuery.split(' ')
        const regex = { $regex: RegExp(query[queryName].replace(/[^\w]/g, '.'), 'i') }
        $queryMatch = { $or: fields.map(field => ({ [`${field}`]: regex })) }
      }
      let $queryDefault = getDefault()
      if (Object.keys($queryMatch).length === 0 &&
        Object.keys($queryDefault).length === 0) {
        return []
      } else {
        return [{ $match: { ...$queryMatch, ...$queryDefault } }]
      }
    }
    
    function getFieldsProject (query: TObject) :TObject | undefined {
      if (!query[fieldsQueryName] && defaultFields) {
        query[fieldsQueryName] = defaultFields
      }
      let $project = stringToQuery(query[fieldsQueryName])
      $project = removeKeys($project, __protected)
      delete query[fieldsQueryName]
      return $project
    }

    function getSort () :[any?] {
      if (!query[sortQueryName]) {
        if (!defaultSort) return []
        query[sortQueryName] = defaultSort
      }
      const regex = /(-)?([\w.]+)/g
      const $sort: any = {}
      let matched
      while ((matched = regex.exec(query[sortQueryName])) !== null) {
        $sort[matched[2]] = matched[1] ? -1 : 1
      }
      delete query[sortQueryName]
      return [{ $sort }]
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
          $unwind: { path: `$${localField}`, preserveNullAndEmptyArrays: true }
        })
      })
      return lookups
    }

    function getUnwind () {
      if (!query[unwindName]) return []
      return [
        {
          $unwind: {
            path: `$${query[unwindName]}`, preserveNullAndEmptyArrays: true
          }
        }
      ]
    }


    const $match = getMatch()
    const $project = getFieldsProject(query)
    const lookups = getLookups($project)
    return [
      ...lookups,
      ...getUnwind(),
      ...$match,
      ...getSort(),
      { $skip: ($page - 1) * $limit },
      { $limit },
      ...$project ? [{ $project }] : [],
    ]
  }
}
