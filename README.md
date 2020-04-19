# mongoose-smart-query

`mongoose-smart-query` toma como entrada un objeto (ejemplo: `req.query`) e
interpreta las condiciones para poder realizar una consulta 'inteligente', de
acuerdo al esquema definido en mongoose. Las consultas se las realiza totalmente
con [aggregate](https://docs.mongodb.com/manual/aggregation).

## Options
All fields below are optional.

Key | Description | Default
---|---|---
`protectedFields: string`| Fields that should not be included in the query results | `''`
`defaultFields: string` | Fields included in the default query results | `'_id'`
`defaultSort: string` | Default sorting | `'-id'`
`defaultLimit: number` | Number of documents per query | `20`
`fieldsForDefaultQuery` | What fields to look for when making a query | `''`
`pageQueryName: string` | Key for pagination | `'$page'`
`limitQueryName: string` | Key to limit | `'$limit'`
`fieldsQueryName: string` | Key to get specific fields | `'$fields'`
`sortQueryName: string` | Key for sorting | `$sort`
`queryName: string` | Key to search | `'$q'`
`unwindName: string` | mongodb unwind documents | `'$unwind'`

