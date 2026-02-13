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

## Plugin Configuration

These options are passed to the plugin during registration: `schema.plugin(mongooseSmartQuery, options)`.

| Key                     | Description                                             | Default     |
| ----------------------- | ------------------------------------------------------- | ----------- |
| `protectedFields`       | Fields that should not be included in the query results | `''`        |
| `defaultFields`         | Fields included in the default query results            | `'_id'`     |
| `defaultSort`           | Default sorting                                         | `'-id'`     |
| `defaultLimit`          | Number of documents per query                           | `20`        |
| `fieldsForDefaultQuery` | specific fields to filter when `'$q'` is present        | `''`        |
| `pageQueryName`         | Key for pagination param in query object                | `'$page'`   |
| `limitQueryName`        | Key for limit param in query object                     | `'$limit'`  |
| `fieldsQueryName`       | Key to project specific fields                          | `'$fields'` |
| `sortQueryName`         | Key for sorting param                                   | `$sort`     |
| `searchQueryName`       | Key for text search param                               | `'$search'` |
| `unwindName`            | Key for unwind param                                    | `'$unwind'` |

## Method Options

These options are passed as the second argument to `smartQuery(query, options)`.

| Key            | Description                                                                            | Default |
| -------------- | -------------------------------------------------------------------------------------- | ------- |
| `autoPaginate` | If true, returns `{ data, pagination }`. **Defaults to `true` in next major version.** | `false` |
| `prePipeline`  | Array of aggregation stages to run before the main query logic                         | `[]`    |
