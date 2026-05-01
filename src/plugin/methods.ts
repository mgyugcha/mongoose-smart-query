import { Model, Types, connection } from 'mongoose'
import type {
  LookupConfirmado,
  PluginOptions,
  SmartQueryOptions,
  SmartQueryPagination,
  SmartQueryResult,
} from '../types'
import { getCampo, reemplazarSubdoc } from '../utils'
import {
  buildTypesenseSearchParameters,
  globalTypesenseClient,
} from '../typesense'

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

    if (globalTypesenseClient && typesense) {
      try {
        const searchParams = buildTypesenseSearchParameters(
          query,
          typesense.schema,
          options,
        )
        const searchResults = await globalTypesenseClient
          .collections(typesense.typesenseCollection)
          .documents()
          .search(searchParams)
        typesenseIds =
          searchResults.hits?.map((h) => (h.document as any).id as string) || []
        typesenseTotal = searchResults.found || 0
        useMongoDirectly = false
      } catch (error) {
        console.error(
          'Error fetching from Typesense, falling back to MongoDB:',
          error,
        )
        useMongoDirectly = true
      }
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
  ) {
    if (globalTypesenseClient && typesense) {
      try {
        const searchParams = buildTypesenseSearchParameters(
          query,
          typesense.schema,
          options,
        )
        const searchResults = await globalTypesenseClient
          .collections(typesense.typesenseCollection)
          .documents()
          .search(searchParams)
        return searchResults.found || 0
      } catch (error) {
        console.error(
          'Error fetching count from Typesense, falling back to MongoDB:',
          error,
        )
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
