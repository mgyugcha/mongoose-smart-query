# mongoose-smart-query

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
`queryName` | Key to search | `'$q'`
`unwindName` | mongodb unwind documents | `'$unwind'`

## Methods

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