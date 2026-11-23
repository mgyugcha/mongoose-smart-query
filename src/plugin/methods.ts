import { Model, Types, connection } from 'mongoose'
import type { SearchParams } from 'typesense/lib/Typesense/Documents'
import type {
  LookupConfirmado,
  PluginOptions,
  SmartQueryOptions,
  SmartQueryPagination,
  SmartQueryResult,
  SmartQueryTypesenseOptions,
} from '../types'
import { getCampo, reemplazarSubdoc } from '../utils'
import {
  buildTypesenseSearchParameters,
  hasUnindexedFields,
} from '../typesense'
import { resolveTypesenseClient } from '../typesense/config'

const TYPESENSE_FAILURE_LOG_INTERVAL_MS = 60 * 1000
const lastTypesenseFailureLogAt: Record<string, number> = Object.create(null)

const conciseErrorMessage = (message: string): string =>
  message
    .split('\n')[0]
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\?\S*/g, '')
    .trim()
    .slice(0, 120)

const typesenseHttpStatus = (error: unknown): number | undefined => {
  const status = (error as { httpStatus?: unknown } | null)?.httpStatus
  return typeof status === 'number' ? status : undefined
}

const typesenseFailureCause = (error: unknown): string => {
  const typed = error as
    | { code?: unknown; httpStatus?: unknown; message?: unknown }
    | null
    | undefined
  const parts: string[] = []
  if (typeof typed?.code === 'string' || typeof typed?.code === 'number') {
    parts.push(String(typed.code))
  }
  const httpStatus = typesenseHttpStatus(error)
  if (httpStatus !== undefined) {
    parts.push(`HTTP ${httpStatus}`)
  }
  if (typeof typed?.message === 'string') {
    const message = conciseErrorMessage(typed.message)
    if (message) parts.push(message)
  }
  return parts.join(', ') || 'error desconocido'
}

const logTypesenseFailure = (collection: string, error: unknown) => {
  const httpStatus = typesenseHttpStatus(error)
  const cause = typesenseFailureCause(error)
  const isRejectedQuery =
    httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500

  // A rejected query is per-call; it must be visible every time.
  if (isRejectedQuery) {
    console.error(
      `[mongoose-smart-query] Typesense rechazó la consulta en ${collection} (${cause}); usando MongoDB`,
    )
    return
  }

  const now = Date.now()
  const lastLogAt = lastTypesenseFailureLogAt[collection]
  if (
    lastLogAt !== undefined &&
    now - lastLogAt < TYPESENSE_FAILURE_LOG_INTERVAL_MS
  ) {
    return
  }
  lastTypesenseFailureLogAt[collection] = now
  console.error(
    `[mongoose-smart-query] Typesense no disponible en ${collection} (${cause}); usando MongoDB`,
  )
}

const shouldUseTypesense = (
  query: { [key: string]: string },
  options: PluginOptions,
  smartOptions: SmartQueryOptions,
): boolean => {
  const { typesense } = options
  const callOptions = smartOptions.typesense
  if (!typesense) return false
  if (callOptions?.enabled === false) return false
  if (typesense.activation === 'opt-in' && !callOptions) return false
  return !hasUnindexedFields(query, typesense.schema, options)
}

const mergeFilterBy = (
  filters: Array<string | undefined>,
): string | undefined => {
  const parts = filters.filter(
    (filter): filter is string =>
      typeof filter === 'string' && filter.trim() !== '',
  )
  if (parts.length === 0) return undefined
  // Each part is wrapped so an extra `||` cannot escape the generated filter.
  return parts.map((filter) => `(${filter})`).join(' && ')
}

const buildTypesenseSearchParams = (
  query: { [key: string]: string },
  options: PluginOptions,
  callOptions?: SmartQueryTypesenseOptions,
): SearchParams<any> => {
  const params = buildTypesenseSearchParameters(
    query,
    options.typesense!.schema,
    options,
    options.typesense,
  )

  const searchParameters = callOptions?.searchParameters
  let searchParametersFilterBy: string | undefined
  if (searchParameters) {
    const restParams: Record<string, any> = { ...searchParameters }
    searchParametersFilterBy = restParams.filter_by
    delete restParams.filter_by
    Object.assign(params, restParams)
  }

  if (callOptions?.filterBy || searchParametersFilterBy) {
    params.filter_by = mergeFilterBy([
      params.filter_by,
      callOptions?.filterBy,
      searchParametersFilterBy,
    ])
  }

  return params
}

export function createSmartQuery(options: PluginOptions) {
  const {
    defaultLimit = 20,
    pageQueryName = '$page',
    limitQueryName = '$limit',
    collation,
    typesense,
  } = options

  return async function <T>(
    this: Model<T>,
    query: { [key: string]: string } = {},
    smartOptions: SmartQueryOptions = {},
  ): Promise<T[] | SmartQueryResult<T>> {
    const { prePipeline = [], autoPaginate = false } = smartOptions

    let docs: any[] = []
    let pagination: SmartQueryPagination | null = null
    let lookupsConfirmados: LookupConfirmado[]

    let useMongoDirectly = true
    let typesenseIds: string[] = []
    let typesenseTotal = 0

    const typesenseClient =
      typesense && shouldUseTypesense(query, options, smartOptions)
        ? resolveTypesenseClient(typesense.clientOptions)
        : null

    if (typesenseClient) {
      try {
        const searchParams = buildTypesenseSearchParams(
          query,
          options,
          smartOptions.typesense,
        )
        const searchResults = await typesenseClient
          .collections(typesense!.schema.name)
          .documents()
          .search(searchParams)
        typesenseIds =
          searchResults.hits?.map((h) => (h.document as any).id as string) || []
        typesenseTotal = searchResults.found || 0
        useMongoDirectly = false
      } catch (error) {
        logTypesenseFailure(typesense!.schema.name, error)
        useMongoDirectly = true
      }
    }

    if (!useMongoDirectly && typesenseTotal === 0) {
      if (autoPaginate) {
        return {
          data: [],
          pagination: {
            total: 0,
            page: parseInt(query[pageQueryName]) || 1,
            pages: 0,
            limit: parseInt(query[limitQueryName]) || defaultLimit,
          },
        }
      }
      return []
    }

    if (autoPaginate) {
      const tsIdsArg = useMongoDirectly ? undefined : typesenseIds
      const dataPromise = (this as any)
        .__smartQueryGetPipeline({ ...query }, false, prePipeline, tsIdsArg)
        .then(async ({ pipeline, lookupsConfirmados: lookups }: any) => {
          const agg = this.aggregate(pipeline)
          if (collation) agg.collation(collation)
          return {
            docs: await agg,
            lookups,
          }
        })

      let countPromise
      if (!useMongoDirectly) {
        countPromise = Promise.resolve([{ size: typesenseTotal }])
      } else {
        countPromise = (this as any)
          .__smartQueryGetPipeline(
            { ...query },
            true, // forCount
            prePipeline,
          )
          .then(({ pipeline }: any) => this.aggregate(pipeline))
      }

      const [dataResult, countResult] = await Promise.all([
        dataPromise,
        countPromise,
      ])

      docs = dataResult.docs
      lookupsConfirmados = dataResult.lookups

      const total = countResult[0]?.size || 0
      const page = parseInt(query[pageQueryName]) || 1
      const limit = parseInt(query[limitQueryName]) || defaultLimit
      const pages = Math.ceil(total / limit)
      pagination = { total, page, pages, limit }
    } else {
      const tsIdsArg = useMongoDirectly ? undefined : typesenseIds
      const { pipeline, lookupsConfirmados: lookups } = await (
        this as any
      ).__smartQueryGetPipeline({ ...query }, false, prePipeline, tsIdsArg)
      lookupsConfirmados = lookups
      const agg = this.aggregate(pipeline)
      if (collation) agg.collation(collation)
      docs = await agg
    }

    const queryEmpresa = query.business
      ? { business: new Types.ObjectId(query.business) }
      : {}

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
            docsEx.find((item: any) => item._id.equals(keyPrincipal)),
          )
      }
    }

    if (autoPaginate) {
      return { data: docs, pagination: pagination! }
    }

    return docs
  }
}

export function createSmartCount(options: PluginOptions) {
  const { typesense } = options
  return async function <T>(
    this: Model<T>,
    query: { [key: string]: string } = {},
    smartOptions: SmartQueryOptions = {},
  ) {
    const typesenseClient =
      typesense && shouldUseTypesense(query, options, smartOptions)
        ? resolveTypesenseClient(typesense.clientOptions)
        : null

    if (typesenseClient) {
      try {
        const searchParams = buildTypesenseSearchParams(
          query,
          options,
          smartOptions.typesense,
        )
        const searchResults = await typesenseClient
          .collections(typesense!.schema.name)
          .documents()
          .search(searchParams)
        return searchResults.found || 0
      } catch (error) {
        logTypesenseFailure(typesense!.schema.name, error)
      }
    }

    const { pipeline } = await (this as any).__smartQueryGetPipeline(
      { ...query },
      true,
    )
    const result = await this.aggregate(pipeline)
    return result.length === 0 ? 0 : result[0].size
  }
}
