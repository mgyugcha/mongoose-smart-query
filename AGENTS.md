# AGENTS.md

Mongoose plugin published as `mongoose-smart-query`. Built with `tsc` (ES5, CJS output), tested with `jest` (ts-jest), linted with `eslint` (flat config v10). Package manager is **pnpm** (`packageManager: pnpm@10.29.3`).

## Commands

All scripts in `package.json` assume `pnpm`:

- `pnpm install` — install deps
- `pnpm run build` — `tsc` to `dist/`. The `tsconfig.json` uses `"files": ["src/index.ts"]` so **only the entry and its transitive imports** are type-checked. Other files may have type errors but won't block the build.
- `pnpm test` — `jest` (picks up `*.spec.ts` under `test/`)
- `pnpm run test:coverage` — `jest --coverage`
- `pnpm run lint` — `eslint --ext .ts .`

Run a single test: `pnpm test -- test/typesense.spec.ts` or `pnpm test -- -t "word by word search"`.

**No husky / lint-staged** — the `precommit` / `prepush` scripts in `package.json` are regular scripts, not auto-triggered hooks.

## CI vs local

CI (`.github/workflows/testing.yml`): Node 14.x, **npm** (not pnpm), MongoDB 4.2 via `supercharge/mongodb-github-action@1.3.0`. This is much older than the `mongoose ^8` / `typesense ^3.0.6` peerDeps.

## Test & MongoDB prerequisites

| Spec file | Mongo connection | Requirements |
|---|---|---|
| `test/typesense.spec.ts` | **None** — mocks `typesense` via `jest.mock('typesense', ...)` | Fastest feedback when changing Typesense code |
| `test/mongoose-smart-query.spec.ts` (via `load-database.ts:8`) | `mongodb://localhost/<db>?replicaSet=rs0` | Needs a **replica set named `rs0`**. Plain `mongod` fails. Setup: `mongod --replSet rs0 --port 27017` then `mongosh` → `rs.initiate({_id:"rs0", members:[{_id:0, host:"localhost:27017"}]})` |
| `test/pagination.spec.ts:8`, `test/hybrid_search.spec.ts:8`, `test/array-casting.spec.ts:8` | `mongodb://127.0.0.1:27017/<dbname>` | Plain `mongod` enough |

## Architecture

- **`src/index.ts`** — entry. Default-exports the plugin; re-exports `types/`, `utils/`, `typesense/`.
- **`src/plugin/index.ts`** — `mongooseSmartQuery(schema, options)`. Attaches three statics:
  - `__smartQueryGetPipeline(query, forCount?, prePipeline?, typesenseIds?)` → `{ pipeline, lookupsConfirmados }`
  - `smartQuery(query, options?)` — public API. Supports `{ autoPaginate: true }` → `{ data, pagination }` shape
  - `smartCount(query)`
- **Pipeline assembly**: `src/plugin/pipeline.ts` (Mongo aggregation). Methods: `src/plugin/methods.ts` (Mongo + optional Typesense pre-filter + post-agg `$lookup` hydration via `connection.collection`).
- **`src/types/`** — `PluginOptions`, `SmartQueryStatics`, `SmartQueryResult`, `LookupConfirmado`, etc.
- **`src/utils/`** — `stringToQuery` (parses `name friends { name }` into projection), `normalizeSearchText`, `parseValue`, `removeKeys`, `getListOfPossibleLookups`, `asignarLookups`, `getCampo`, `reemplazarSubdoc`.
- **`src/typesense/`** — `config.ts` (singleton `globalTypesenseClient` + `setTypesenseConfig()`), `builder.ts` (`buildTypesenseSearchParameters`, `hasUnindexedFields`).

### Default values in code vs docs

- `defaultSort` defaults to `'-_id'` in code (`src/plugin/index.ts:13`, `pipeline.ts:27`), but the README table says `'-id'`. Docs are wrong; always apply `'-_id'`.
- `allFieldsQueryName` (`'$getAllFields'` in code) — undocumented `true`/`false` query key that skips projection and returns every field except `protectedFields`.
- `collation` option — accepted in `PluginOptions` but undocumented in README. Passed to `aggregate()` calls.

## Typesense gotchas

- `setTypesenseConfig()` writes a **module-level singleton** (`globalTypesenseClient`). One call at startup affects every model with a `typesense` option.
- Typesense routing triggers **only if every non-special key** in the query maps to a Typesense field (`hasUnindexedFields` in `src/typesense/builder.ts:177`). Otherwise falls back to MongoDB, logging `"Error fetching from Typesense, falling back to MongoDB:"` (or `"...count..."` equivalent).
- `mongoField` mapping (`{ name: 'issueDate', mongoField: 'fecha_emision' }`) — the builder resolves field lookups via `f.mongoField || f.name` throughout.
- Date-like values on `int`/`float` Typesense fields are auto-converted to Unix-ms timestamps (`src/typesense/builder.ts:87-110`).

## Style & formatting

Prettier (`.prettierrc.json`): **no semicolons**, single quotes, 2-space indent, `trailingComma: "all"`, `printWidth: 80`. ESLint flat config (`eslint.config.mjs`) uses `@eslint/js` + `typescript-eslint` recommended, only overriding `@typescript-eslint/no-explicit-any` → `warn`.

## Build artifacts

`dist/` is published (`main: ./dist/index.js`, `types: ./dist/index.d.ts`). `.npmignore` excludes `src/`, `test/`, config files, `*.tgz`, and `.github/`. Local `mongoose-smart-query-*.tgz` files in root are gitignored.
