import type { SearchParams } from 'typesense/lib/Typesense/Documents'
import type { PluginOptions, PluginTypesenseOptions } from '../types'

export const buildTypesenseSearchParameters = (
  query: { [key: string]: string },
  tsSchema: PluginTypesenseOptions['schema'],
  options: PluginOptions,
): SearchParams<any> => {
  const {
    queryName = '$q',
    pageQueryName = '$page',
    limitQueryName = '$limit',
    defaultLimit = 20,
    fieldsForDefaultQuery = '',
    sortQueryName = '$sort',
    fieldsQueryName = '$fields',
    unwindName = '$unwind',
    textQueryName = '$text',
    allFieldsQueryName = '$getAllFields',
    defaultSort = '-_id',
  } = options

  const $q = query[queryName] || '*'
  const page = parseInt(query[pageQueryName]) || 1
  const limit = parseInt(query[limitQueryName]) || defaultLimit

  let queryByFields = tsSchema.fields
    ?.filter((f) => f.type.includes('string') && f.name !== 'id' && !f.facet)
    .map((f) => f.name)

  if (fieldsForDefaultQuery) {
    queryByFields = fieldsForDefaultQuery
      .split(' ')
      .map((mongoField) => {
        const field = tsSchema.fields?.find(
          (f) => (f.mongoField || f.name) === mongoField,
        )
        return field ? field.name : mongoField
      })
      .filter((field) => tsSchema.fields?.some((f) => f.name === field))
  }

  const searchParams: SearchParams<any> = {
    q: $q,
    query_by: queryByFields?.length ? queryByFields.join(',') : '*',
    page,
    per_page: limit,
  }

  const filterBy: string[] = []

  for (const key in query) {
    if (
      [
        pageQueryName,
        limitQueryName,
        sortQueryName,
        queryName,
        fieldsQueryName,
        unwindName,
        textQueryName,
        allFieldsQueryName,
      ].includes(key)
    ) {
      continue
    }
    const field = tsSchema.fields?.find((f) => (f.mongoField || f.name) === key)
    if (!field) continue

    const tsFieldName = field.name

    const val = query[key]
    if (typeof val !== 'string') continue

    const queryRegex = /(?:\{(\$?[\w ]+)\})?([^{}\n]+)/g
    let match
    const values: Array<[string, string, string]> = []
    let valor = val
    if (valor.startsWith('{$or}')) valor = valor.replace('{$or}', '')

    while ((match = queryRegex.exec(valor)) !== null) {
      values.push([match[0], match[1], match[2]])
    }

    for (const [, operator, value] of values) {
      let finalValue = value
      if (field.type.includes('int') || field.type.includes('float')) {
        const parsedDate = Date.parse(value)
        if (!isNaN(parsedDate) && value.includes('-')) {
          finalValue = parsedDate.toString()
        }
      }

      const tsValue =
        finalValue.includes(' ') || finalValue.includes('-')
          ? `\`${finalValue}\``
          : finalValue
      const tsValues = finalValue
        .split(',')
        .map((v) => {
          const vTrim = v.trim()
          let parsedTrim = vTrim
          if (field.type.includes('int') || field.type.includes('float')) {
            const pDate = Date.parse(vTrim)
            if (!isNaN(pDate) && vTrim.includes('-')) {
              parsedTrim = pDate.toString()
            }
          }
          return parsedTrim.includes(' ') || parsedTrim.includes('-')
            ? `\`${parsedTrim}\``
            : parsedTrim
        })
        .join(',')

      switch (operator) {
        case '$in':
          filterBy.push(`${tsFieldName}:=[${tsValues}]`)
          break
        case '$nin':
          filterBy.push(`${tsFieldName}:!=[${tsValues}]`)
          break
        case '$gte':
          filterBy.push(`${tsFieldName}:>=${finalValue}`)
          break
        case '$gt':
          filterBy.push(`${tsFieldName}:>${finalValue}`)
          break
        case '$lte':
          filterBy.push(`${tsFieldName}:<=${finalValue}`)
          break
        case '$lt':
          filterBy.push(`${tsFieldName}:<${finalValue}`)
          break
        case '$ne':
          filterBy.push(`${tsFieldName}:!=${tsValue}`)
          break
        case '$exists':
        case '$includes':
          // Typesense doesn't natively support $exists or $includes in filter_by efficiently
          break
        default:
          if (finalValue.includes('$exists')) break
          filterBy.push(`${tsFieldName}:=${tsValue}`)
          break
      }
    }
  }

  if (filterBy.length > 0) {
    searchParams.filter_by = filterBy.join(' && ')
  }

  if (query[sortQueryName] || defaultSort) {
    const sortQuery = query[sortQueryName] || defaultSort
    const regex = /(-)?([\w.]+)/g
    let matched
    const sortBy: string[] = []
    while ((matched = regex.exec(sortQuery)) !== null) {
      const order = matched[1] ? 'desc' : 'asc'
      const localfield = matched[2]

      const field = tsSchema.fields?.find(
        (f) => (f.mongoField || f.name) === localfield,
      )
      if (field) {
        sortBy.push(`${field.name}:${order}`)
      }
    }
    if (sortBy.length > 0) {
      searchParams.sort_by = sortBy.join(',')
    }
  }

  return searchParams
}

export const hasUnindexedFields = (
  query: { [key: string]: string },
  tsSchema: PluginTypesenseOptions['schema'],
  options: PluginOptions,
): boolean => {
  const {
    queryName = '$q',
    pageQueryName = '$page',
    limitQueryName = '$limit',
    sortQueryName = '$sort',
    fieldsQueryName = '$fields',
    unwindName = '$unwind',
    textQueryName = '$text',
    allFieldsQueryName = '$getAllFields',
  } = options

  const specialKeys = [
    pageQueryName,
    limitQueryName,
    sortQueryName,
    queryName,
    fieldsQueryName,
    unwindName,
    textQueryName,
    allFieldsQueryName,
  ]

  for (const key in query) {
    if (specialKeys.includes(key)) continue
    const field = tsSchema.fields?.find(
      (f) => (f.mongoField || f.name) === key,
    )
    if (!field) return true
  }

  return false
}
