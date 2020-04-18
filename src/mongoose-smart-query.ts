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
  fieldsForDefaultQuery = undefined,
}: PluginOptions) {
  const __protected = stringToQuery(protectedFields)
  // schema._smartRestOptions = {
  //   options: _options,
  //   protected: stringToQuery(_options.protectedFields),
  // }

  schema.statics.smartQuery = function (query: any = {}) {
    const pipeline = this.__smartQueryGetPipeline(Object.assign({}, query))
    return this.aggregate(pipeline)
  }


  schema.statics.__smartQueryGetPipeline = function (query: any, forCount = false) {
    const $page = parseInt(query[pageQueryName]) || 1
    delete query[pageQueryName]
    const $limit = parseInt(query[limitQueryName]) || defaultLimit
    delete query[limitQueryName]
    /* let $project
    let $sort
    let $match
    let $unwind
    const lookups = []

    function getQuery () {
      if (!query[_options.queryName]) return
      const fields = (fields => (
        typeof fields === 'string' ? fields.split(' ') : []
      ))(_options.fieldsForDefaultQuery)
      if (fields.length === 0) {
        return console.warn('Set the fieldsForDefaultQuery variable')
      }
      let q = query[_options.queryName]
      q = q.replace(/[^\w-@ ]/g, '').replace(/\s+/g, ' ')
      const regex = { $regex: RegExp(q, 'i') }
      $match = {
        $or: fields.reduce((acc, val) => [...acc, { [`${val}`]: regex }], [])
      }
      delete query[_options.queryName]
    }

    function getUnwind () {
      if (!query[_options.unwindName]) return
      $unwind = { path: `$${query[_options.unwindName]}`, preserveNullAndEmptyArrays: true }
      delete query[_options.unwindName]
    }

    function getDefault () {
      for (const key in query) {
        if (['getters', 'virtuals', 'populate'].includes(key)) continue
        if (!$match) $match = {}
        const value = query[key]
        if (value.includes('$exists')) {
          $match[key] = { $exists: true, $ne: [] }
        } else {
          const path = schema.path(key)
          const instance = path ? path.instance : undefined
          $match[key] = parseValue(value, instance)
        }
      }
    } */

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
    /*
    $project = getFieldsProject(query)
    console.log(getLookups($project))
    // do lookup
    utils.getListOfPossibleLookups($project).forEach(localField => {
      const path = schema.path(localField)
      if (!path || !path.options.ref) return
      const { ref: from } = path.options
      lookups.push({
        $lookup: { from, localField, foreignField: '_id', as: localField },
      }, {
        $unwind: { path: `$${localField}`, preserveNullAndEmptyArrays: true }
      })
    })

    getSort()
    getUnwind()
    getQuery()
    getDefault()

    const pipeline = [...lookups]
    if ($match) pipeline.push({ $match })
    if ($unwind) pipeline.push({ $unwind })
    if (!forCount) {
      if ($sort) pipeline.push({ $sort })
      pipeline.push({ $skip: ($page - 1) * $limit }, { $limit })
      if ($project) pipeline.push({ $project })
    } else {
      pipeline.push({ $count: 'length' })
    } */
    const $project = getFieldsProject(query)
    return [
      ...getSort(),
      { $skip: ($page - 1) * $limit },
      { $limit },
      ...$project ? [{ $project }] : [],
    ]
  }

  /*

  function getLookups ($project) {
    const $lookups = []
    utils.getListOfPossibleLookups($project).forEach(localField => {
      const path = schema.path(localField)
      if (!path || !path.options.ref) return
      const { ref: from } = path.options
      const foreignModel = mongoose.model(from)
      if (foreignModel) {
        console.log(foreignModel.schema)
      }
      $lookups.push({
        $lookup: { from, localField, foreignField: '_id', as: localField },
      }, {
        $unwind: { path: `$${localField}`, preserveNullAndEmptyArrays: true }
      })
    })
    return $lookups
  }

  schema.statics.smartQueryCount = function (query = {}) {
    const pipeline = this.__smartQueryGetPipeline(Object.assign({}, query), true)
    return new Promise((resolve, reject) => {
      this.aggregate(pipeline)
        .then(data => {
          resolve(data.length !== 0 ? data[0].length : 0)
        })
        .catch(err => reject(err))
    })
  }
 */
}

/* function parseValue (value, instance) {
  switch (instance) {
    case 'ObjectID':
      return ObjectId(value)
    case 'Date':
      return new Date(value)
    default:
      return value
  }
}
 */