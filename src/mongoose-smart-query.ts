// const mongoose = require('mongoose')
// const { ObjectId } = mongoose.Types

// const defaultOptions = {
//   protectedFields: undefined,
//   defaultFields: undefined,
//   defaultSort: '-_id',
//   defaultLimit: 20,
//   defaultFieldsForQuery: undefined,
//   // query
//   pageQueryName: '$page',
//   limitQueryName: '$limit',
//   fieldsQueryName: '$fields',
//   sortQueryName: '$sort',
//   queryName: '$q',
//   unwindName: '$unwind',
//   fieldsForDefaultQuery: undefined,
// }

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

// module.exports = exports = function (schema, optionsParams) {
//   const _options = Object.assign({}, defaultOptions, optionsParams)
//   const _protected = stringToQuery(_options.protectedFields)
//   schema._smartRestOptions = {
//     options: _options,
//     protected: _protected,
//   }
  
//   function getFieldsProject (query) {
//     const fields = query[_options.fieldsQueryName] || _options.defaultFields
//     if (!fields) return {}
//     const $project = stringToQuery(query[_options.fieldsQueryName])
//     removeKeys($project, _protected)
//     delete query[_options.fieldsQueryName]
//     return $project
//   }

//   function getLookups ($project) {
//     const $lookups = []
//     utils.getListOfPossibleLookups($project).forEach(localField => {
//       const path = schema.path(localField)
//       if (!path || !path.options.ref) return
//       const { ref: from } = path.options
//       const foreignModel = mongoose.model(from)
//       if (foreignModel) {
//         console.log(foreignModel.schema)
//       }
//       $lookups.push({
//         $lookup: { from, localField, foreignField: '_id', as: localField },
//       }, {
//         $unwind: { path: `$${localField}`, preserveNullAndEmptyArrays: true }
//       })
//     })
//     return $lookups
//   }

//   schema.statics.smartQuery = function (query = {}) {
//     const pipeline = this.__smartQueryGetPipeline(Object.assign({}, query))
//     return this.aggregate(pipeline)
//   }

//   schema.statics.smartQueryCount = function (query = {}) {
//     const pipeline = this.__smartQueryGetPipeline(Object.assign({}, query), true)
//     return new Promise((resolve, reject) => {
//       this.aggregate(pipeline)
//         .then(data => {
//           resolve(data.length !== 0 ? data[0].length : 0)
//         })
//         .catch(err => reject(err))
//     })
//   }

//   schema.statics.__smartQueryGetPipeline = function (query, forCount = false) {
//     const $page = parseInt(query[_options.pageQueryName]) || 1
//     delete query[_options.pageQueryName]
//     const $limit = parseInt(query[_options.limitQueryName]) || _options.defaultLimit
//     delete query[_options.limitQueryName]
//     let $project
//     let $sort
//     let $match
//     let $unwind
//     const lookups = []

//     function getQuery () {
//       if (!query[_options.queryName]) return
//       const fields = (fields => (
//         typeof fields === 'string' ? fields.split(' ') : []
//       ))(_options.fieldsForDefaultQuery)
//       if (fields.length === 0) {
//         return console.warn('Set the fieldsForDefaultQuery variable')
//       }
//       let q = query[_options.queryName]
//       q = q.replace(/[^\w-@ ]/g, '').replace(/\s+/g, ' ')
//       const regex = { $regex: RegExp(q, 'i') }
//       $match = {
//         $or: fields.reduce((acc, val) => [...acc, { [`${val}`]: regex }], [])
//       }
//       delete query[_options.queryName]
//     }

//     function getUnwind () {
//       if (!query[_options.unwindName]) return
//       $unwind = { path: `$${query[_options.unwindName]}`, preserveNullAndEmptyArrays: true }
//       delete query[_options.unwindName]
//     }

//     function getDefault () {
//       for (const key in query) {
//         if (['getters', 'virtuals', 'populate'].includes(key)) continue
//         if (!$match) $match = {}
//         const value = query[key]
//         if (value.includes('$exists')) {
//           $match[key] = { $exists: true, $ne: [] }
//         } else {
//           const path = schema.path(key)
//           const instance = path ? path.instance : undefined
//           $match[key] = parseValue(value, instance)
//         }
//       }
//     }

//     function getSort () {
//       if (!query[_options.sortQueryName]) {
//         if (!_options.defaultSort) return
//         query[_options.sortQueryName] = _options.defaultSort
//       }
//       const regex = /(-)?([\w.]+)/g
//       $sort = {}
//       let matched
//       while ((matched = regex.exec(query[_options.sortQueryName])) !== null) {
//         $sort[matched[2]] = matched[1] ? -1 : 1
//       }
//       delete query[_options.sortQueryName]
//     }

//     $project = getFieldsProject(query)
//     console.log(getLookups($project))
//     // do lookup
//     utils.getListOfPossibleLookups($project).forEach(localField => {
//       const path = schema.path(localField)
//       if (!path || !path.options.ref) return
//       const { ref: from } = path.options
//       lookups.push({
//         $lookup: { from, localField, foreignField: '_id', as: localField },
//       }, {
//         $unwind: { path: `$${localField}`, preserveNullAndEmptyArrays: true }
//       })
//     })

//     getSort()
//     getUnwind()
//     getQuery()
//     getDefault()

//     const pipeline = [...lookups]
//     if ($match) pipeline.push({ $match })
//     if ($unwind) pipeline.push({ $unwind })
//     if (!forCount) {
//       if ($sort) pipeline.push({ $sort })
//       pipeline.push({ $skip: ($page - 1) * $limit }, { $limit })
//       if ($project) pipeline.push({ $project })
//     } else {
//       pipeline.push({ $count: 'length' })
//     }
//     return pipeline
//   }
// }

// /**
//  * Converts a string to object. Example:
//  * 'name age friends { name }' => { name: 1, age: 1, friends: { name: 1 } }
//  * @param {String} query - String to convert to Object.
//  * @returns {Object} The resulting object.
//  */
// function stringToQuery (query = '') {
//   const regex = /([\w.]+)(?![\w.]|\ ?\{)|([\w.]+)(?=\ ?\{)/g
//   let $project = query.replace(regex, (match, p1, p2) => {
//     return p1 ? `"${p1}": 1,` : (p2 ? `"${p2}":` : '')
//   })
//   $project = $project.replace(/,[ ]*}/g, ' },')
//   if ($project[$project.length - 1] === ',') {
//     $project = $project.substring(0, $project.length - 1)
//   }
//   return JSON.parse(`{ ${$project} }`)
// }

// /**
//  * Remove the keys from the pricipal Object.
//  * @param {Object} principal The main object
//  * @param {Object} toRemove The object with the keys to remove
//  */
// function removeKeys (principal, toRemove) {
//   for (const key in toRemove) {
//     if (!principal[key]) continue
//     if (typeof toRemove[key] === 'object') {
//       removeKeys(principal[key], toRemove[key])
//       if (Object.keys(principal[key]).length === 0) delete principal[key]
//     } else {
//       delete principal[key]
//     }
//   }
// }

// function parseValue (value, instance) {
//   switch (instance) {
//     case 'ObjectID':
//       return ObjectId(value)
//     case 'Date':
//       return new Date(value)
//     default:
//       return value
//   }
// }
