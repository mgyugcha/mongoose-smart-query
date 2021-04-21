# mongoose-smart-query

[![npm version](https://badge.fury.io/js/mongoose-smart-query.svg)](https://badge.fury.io/js/mongoose-smart-query)
![Testing](https://github.com/mgyugcha/mongoose-smart-query/workflows/Testing/badge.svg)

`mongoose-smart-query` toma como entrada un objeto (ejemplo: `req.query`) e
interpreta las condiciones para poder realizar una consulta 'inteligente', de
acuerdo al esquema definido en mongoose. Las consultas se las realiza totalmente
con [aggregate](https://docs.mongodb.com/manual/aggregation).

## Options
- All fields below are optional.
- All the fields are of type string, except the `defaultLimit` field which is of
  type number

Key | Description | Default
---|---|---
`protectedFields`| Fields that should not be included in the query results | `''`
`defaultFields` | Fields included in the default query results | `'_id'`
`defaultSort` | Default sorting | `'-id'`
`defaultLimit` | Number of documents per query | `20`
`fieldsForDefaultQuery` | What fields to look for when making a query | `''`
`pageQueryName` | Key for pagination | `'$page'`
`limitQueryName` | Key to limit | `'$limit'`
`fieldsQueryName` | Key to get specific fields | `'$fields'`
`sortQueryName` | Key for sorting | `$sort`
`queryName` | Key for search | `'$q'`
`unwindName` | mongodb unwind documents | `'$unwind'`

## Methods

### Pagination

- `$limit`: Limit the number of records returned
- `$page`: Navigate to the records on the page

```js
{
  $limit: 20,
  $page: 3,
}
```

- If we have 60 records and we limit the results to 20, the maximum number of
  pages will be **3** (60÷20).
- If we access page 4 the result will be an empty array
### Sort

We can sort returned records using the value of the `$sort` property:

```js
// ascendent
{
  $sort: 'name'
}

// descendent
{
  $sort: '-name'
}

// combinated
{
  $sort: '-name surname'
}
```

## Example

This is a simple mongoose model for persons:

```js
const PersonSchema = new mongoose.Schema({
  name: String,
  random: Number,
  birthday: Date,
  colours: [String],
  password: String,
  bestFriend: { type: mongoose.Types.ObjectId, ref: 'persons' },
})
PersonSchema.plugin(mongooseSmartQuery, {
  defaultFields: 'name',
  protectedFields: 'password',
  fieldsForDefaultQuery: 'name bestFriend.name',
})
const Persons = mongoose.model('persons', PersonSchema)
```
