import { Schema } from 'mongoose'
import type { PluginOptions } from '../types'
import { createSmartQueryGetPipeline } from './pipeline'
import { createSmartQuery, createSmartCount } from './methods'

export default function mongooseSmartQuery(
  schema: Schema,
  rawOptions: PluginOptions,
) {
  const options = {
    protectedFields: '',
    defaultFields: '_id',
    defaultSort: '-_id',
    defaultLimit: 20,
    fieldsForDefaultQuery: '',
    pageQueryName: '$page',
    limitQueryName: '$limit',
    fieldsQueryName: '$fields',
    sortQueryName: '$sort',
    queryName: '$q',
    textQueryName: '$text',
    unwindName: '$unwind',
    allFieldsQueryName: '$getAllFields',
    normalizeSearchQuery: false,
    ...rawOptions,
  }

  schema.statics.__smartQueryGetPipeline = createSmartQueryGetPipeline(
    schema,
    options,
  )
  schema.statics.smartQuery = createSmartQuery(options)
  schema.statics.smartCount = createSmartCount(options)
}
