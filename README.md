# mongoose-smart-query

[![npm version](https://badge.fury.io/js/mongoose-smart-query.svg)](https://badge.fury.io/js/mongoose-smart-query)
![Testing](https://github.com/mgyugcha/mongoose-smart-query/workflows/Testing/badge.svg)

`mongoose-smart-query` takes an object (e.g., `req.query`) as input and interprets conditions to perform a "smart" query based on the Mongoose schema definition. Queries are executed entirely using the [aggregation pipeline](https://docs.mongodb.com/manual/aggregation).

## Support for TypeScript

Starting from version 1.1.0, this library includes TypeScript definitions out of the box.

## Installation

```bash
npm install mongoose-smart-query
# or
pnpm add mongoose-smart-query
# or
yarn add mongoose-smart-query
```

## Usage

Register the plugin in your Mongoose schema:

```typescript
import mongoose, { Schema, Model } from 'mongoose'
import mongooseSmartQuery, { SmartQueryStatics } from 'mongoose-smart-query'

interface IPerson {
  name: string
  age: number
  // ... other fields
}

// Extend your model type with SmartQueryStatics for proper typing
export type PersonModel = Model<IPerson> & SmartQueryStatics

const PersonSchema = new Schema<IPerson>({
  name: String,
  age: Number,
  // ...
})

PersonSchema.plugin(mongooseSmartQuery, {
  defaultFields: 'name',
  protectedFields: 'password',
  fieldsForDefaultQuery: 'name',
})

const Person = mongoose.model<IPerson, PersonModel>('Person', PersonSchema)
```

### Auto Pagination

By default, `smartQuery` returns a simple array of documents. To get a paginated result with metadata (total count, pages, etc.), use the `autoPaginate: true` option.

> [!WARNING]
> **Upcoming Change:** In the next major version, `autoPaginate` will default to `true`.

```typescript
// Defined return type (recommended)
const result = await Person.smartQuery<IPerson>(req.query, {
  autoPaginate: true,
})

// Result structure:
// {
//   data: IPerson[],
//   pagination: {
//     total: number,
//     page: number,
//     pages: number,
//     limit: number
//   }
// }
```

### Simple Query (No Pagination)

If `autoPaginate` is false (default current behaviors), it returns `T[]`.

```typescript
const result = await Person.smartQuery<IPerson>(req.query)
// Result: IPerson[]
```

### Searching (Autocomplete and Text Search)

`mongoose-smart-query` provides two built-in ways to search your collections based on the incoming query object (e.g., `req.query`).

1. **Autocomplete/Regex Search (`$q`)**:
   When the `$q` parameter is present in the query, the plugin performs an autocomplete search. To define which fields are searchable via autocomplete, set the `fieldsForDefaultQuery` plugin option.
   - If `fieldsForDefaultQuery` contains a single field, it performs a highly-optimized single-field `$regex` search.
   - If it contains space-separated fields (e.g., `'name email'`), it performs an `$or` `$regex` search across them.

   ```typescript
   // req.query = { $q: 'john' }
   const result = await Person.smartQuery(req.query)
   ```

2. **MongoDB Native Text Search (`$text`)**:
   If your schema has a `text` index (`schema.index({ name: 'text' })`), you can use the `$text` parameter to perform explicit full-text searches. This uses MongoDB's native `$text` operator, sorting results by `$meta` text score automatically.

   ```typescript
   // req.query = { $text: 'developer' }
   const result = await Person.smartQuery(req.query)
   ```

### Normalizing Search Text

Searching for text with accents or special characters can often miss results if the database fields are not normalized (e.g., searching for "José" vs "jose").

`mongoose-smart-query` exports a utility function, `normalizeSearchText`, which converts text to lowercase, removes diacritics/accents, and removes non-alphanumeric characters. You can use it in your pre-save Mongoose hooks to keep a "searchable" field clean in your documents.

```typescript
import { normalizeSearchText } from 'mongoose-smart-query'

PersonSchema.pre('save', function (next) {
  // Create a clean, concatenated string for optimized regex autocomplete
  this.searchString = normalizeSearchText([this.name, this.surname])
  next()
})
```

You can then instruct the plugin to automatically normalize the user's incoming `$q` search parameter to match your cleaned document fields by enabling `normalizeSearchQuery: true`:

```typescript
PersonSchema.plugin(mongooseSmartQuery, {
  fieldsForDefaultQuery: 'searchString', // Point autocomplete to your combined field
  normalizeSearchQuery: true, // Automatically applies normalizeSearchText to req.query.$q
})
```

By combining a single normalized `searchString` field and `normalizeSearchQuery: true`, MongoDB can evaluate your autocomplete searches with optimum efficiency, bypassing the `$and` and case-insensitive (`i`) regex overhead.

## Plugin Configuration

These options are passed to the plugin during registration: `schema.plugin(mongooseSmartQuery, options)`.

| Key                     | Description                                                                | Default     |
| ----------------------- | -------------------------------------------------------------------------- | ----------- |
| `protectedFields`       | Fields that should not be included in the query results                    | `''`        |
| `defaultFields`         | Fields included in the default query results                               | `'_id'`     |
| `defaultSort`           | Default sorting                                                            | `'-id'`     |
| `defaultLimit`          | Number of documents per query                                              | `20`        |
| `fieldsForDefaultQuery` | Fields to perform `$regex` autocomplete search when `queryName` is present | `''`        |
| `pageQueryName`         | Key for pagination param in query object                                   | `'$page'`   |
| `limitQueryName`        | Key for limit param in query object                                        | `'$limit'`  |
| `fieldsQueryName`       | Key to project specific fields                                             | `'$fields'` |
| `sortQueryName`         | Key for sorting param                                                      | `$sort`     |
| `queryName`             | Key for regex autocomplete search param                                    | `'$q'`      |
| `textQueryName`         | Key for explicit MongoDB `$text` index search param                        | `'$text'`   |
| `normalizeSearchQuery`  | Applies `normalizeSearchText` to `$q` automatically                        | `false`     |
| `unwindName`            | Key for unwind param                                                       | `'$unwind'` |

## Method Options

These options are passed as the second argument to `smartQuery(query, options)`.

| Key            | Description                                                                            | Default |
| -------------- | -------------------------------------------------------------------------------------- | ------- |
| `autoPaginate` | If true, returns `{ data, pagination }`. **Defaults to `true` in next major version.** | `false` |
| `prePipeline`  | Array of aggregation stages to run before the main query logic                         | `[]`    |
