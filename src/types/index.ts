import { PipelineStage } from 'mongoose'
import type { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections'

export interface SmartQueryFieldSchema {
  name: string
  type: string
  facet?: boolean
  optional?: boolean
  index?: boolean
  sort?: boolean
  infix?: boolean
  locale?: string
  drop?: boolean
  mongoField?: string
  [key: string]: any
}

export interface PluginTypesenseOptions {
  schema: Omit<CollectionCreateSchema, 'fields'> & {
    fields?: SmartQueryFieldSchema[]
  }
}

export interface LookupConfirmado {
  field: string
  from: string
  project: Record<string, unknown>
}

export type QueryForeign = Record<
  string,
  { collection: string; $match: Record<string, any> }
>

export interface SmartQueryOptions {
  prePipeline?: PipelineStage[]
  autoPaginate?: boolean
}

export interface SmartQueryPagination {
  total: number
  page: number
  pages: number
  limit: number
}

export interface SmartQueryResult<T = any> {
  data: T[]
  pagination: SmartQueryPagination
}

export interface SmartQueryStatics {
  smartQuery<T = any>(
    query: Record<string, any> | undefined,
    options: SmartQueryOptions & { autoPaginate: true },
  ): Promise<SmartQueryResult<T>>

  // Cuando autoPaginate es false o undefined → retorna T[]
  smartQuery<T = any>(
    query?: Record<string, any>,
    options?: SmartQueryOptions & { autoPaginate?: false },
  ): Promise<T[]>

  smartCount(query?: Record<string, any>): Promise<number>

  __smartQueryGetPipeline(
    query: { [key: string]: string },
    forCount?: boolean,
    prePipeline?: PipelineStage[],
    typesenseIds?: string[],
  ): Promise<{
    pipeline: PipelineStage[]
    lookupsConfirmados: LookupConfirmado[]
  }>
}

export interface PluginOptions {
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
   * What fields to look for when making a default search query. Default: `''`.
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
   * Key for specific text index search (MongoDB $text). Default: `'$text'`.
   */
  textQueryName?: string
  /**
   * If true, applies `normalizeSearchText` to the `$q` search value before executing the query. Default: `false`.
   */
  normalizeSearchQuery?: boolean
  /**
   * Collation to be applied to the aggregate queries. Default: `undefined`.
   */
  collation?: any
  /**
   * Configuration for Typesense integration.
   */
  typesense?: PluginTypesenseOptions
}

export interface TObject {
  [value: string]: any
}
