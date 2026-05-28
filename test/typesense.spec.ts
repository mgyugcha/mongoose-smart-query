import mongoose from 'mongoose'
import mongooseSmartQuery, {
  setTypesenseConfig,
  globalTypesenseClient,
} from '../src'
import {
  buildTypesenseSearchParameters,
  hasUnindexedFields,
} from '../src/typesense/builder'

// Mock de Typesense
jest.mock('typesense', () => {
  return {
    Client: jest.fn().mockImplementation(() => {
      return {
        collections: jest.fn().mockReturnThis(),
        documents: jest.fn().mockReturnThis(),
        search: jest.fn(),
      }
    }),
  }
})

describe('Typesense Integration', () => {
  describe('buildTypesenseSearchParameters', () => {
    const tsSchema = {
      name: 'invoices',
      fields: [
        { name: 'id', type: 'string', mongoField: '_id' },
        { name: 'business', type: 'string' },
        { name: 'issueDate', type: 'int64', mongoField: 'fecha_emision' },
        { name: 'amount', type: 'float', mongoField: 'total' },
        { name: 'tags', type: 'string[]', facet: true },
      ],
    }

    const defaultOptions = {
      queryName: '$q',
      pageQueryName: '$page',
      limitQueryName: '$limit',
      defaultLimit: 20,
      sortQueryName: '$sort',
      defaultSort: '-_id',
    }

    it('debe transformar paginación y búsqueda básica', () => {
      const query = { $q: 'test', $page: '2', $limit: '50' }
      const result = buildTypesenseSearchParameters(
        query,
        tsSchema,
        defaultOptions,
      )
      expect(result.q).toBe('test')
      expect(result.page).toBe(2)
      expect(result.per_page).toBe(50)
      // 'id' and faceted fields shouldn't be in query_by
      expect(result.query_by).toBe('business')
    })

    it('debe mapear filtros con operadores $gte y $lte e inferir fechas a timestamps', () => {
      const query = {
        fecha_emision:
          '{$gte}2026-04-14T05:00:00.000Z{$lte}2026-04-15T04:59:59.999Z',
      }
      const result = buildTypesenseSearchParameters(
        query,
        tsSchema,
        defaultOptions,
      )

      const startTimestamp = new Date('2026-04-14T05:00:00.000Z')
        .getTime()
        .toString()
      const endTimestamp = new Date('2026-04-15T04:59:59.999Z')
        .getTime()
        .toString()

      expect(result.filter_by).toContain(`issueDate:>=${startTimestamp}`)
      expect(result.filter_by).toContain(`issueDate:<=${endTimestamp}`)
    })

    it('debe mapear el campo _id correctamente', () => {
      const query = { _id: '5a4ba6433627b0725f1c541d' }
      const result = buildTypesenseSearchParameters(
        query,
        tsSchema,
        defaultOptions,
      )
      expect(result.filter_by).toBe('id:=5a4ba6433627b0725f1c541d')
    })

    it('debe manejar operadores $in y $nin', () => {
      const query = { total: '{$in}100,200,300' }
      const result = buildTypesenseSearchParameters(
        query,
        tsSchema,
        defaultOptions,
      )
      expect(result.filter_by).toBe('amount:=[100,200,300]')
    })

    it('debe mapear ordenamiento (sort)', () => {
      const query = { $sort: '-fecha_emision _id' }
      const result = buildTypesenseSearchParameters(
        query,
        tsSchema,
        defaultOptions,
      )
      expect(result.sort_by).toBe('issueDate:desc,id:asc')
    })
  })

  describe('hasUnindexedFields', () => {
    const tsSchema = {
      name: 'invoices',
      fields: [
        { name: 'id', type: 'string', mongoField: '_id' },
        { name: 'business', type: 'string' },
        { name: 'issueDate', type: 'int64', mongoField: 'fecha_emision' },
        { name: 'amount', type: 'float', mongoField: 'total' },
      ],
    }

    const defaultOptions = {
      queryName: '$q',
      pageQueryName: '$page',
      limitQueryName: '$limit',
      sortQueryName: '$sort',
      fieldsQueryName: '$fields',
      unwindName: '$unwind',
      textQueryName: '$text',
      allFieldsQueryName: '$getAllFields',
    }

    it('debe retornar false cuando todos los campos están en el schema', () => {
      const query = { _id: 'abc123', fecha_emision: '2024-01-01' }
      const result = hasUnindexedFields(query, tsSchema, defaultOptions)
      expect(result).toBe(false)
    })

    it('debe retornar false cuando solo hay claves especiales ($q, $page, etc.)', () => {
      const query = { $q: 'test', $page: '1', $sort: '-_id' }
      const result = hasUnindexedFields(query, tsSchema, defaultOptions)
      expect(result).toBe(false)
    })

    it('debe retornar false cuando no hay campos de filtro', () => {
      const query = { $q: 'test' }
      const result = hasUnindexedFields(query, tsSchema, defaultOptions)
      expect(result).toBe(false)
    })

    it('debe retornar true cuando al menos un campo no está en el schema', () => {
      const query = { $q: 'test', cliente: 'ObjectId("abc")' }
      const result = hasUnindexedFields(query, tsSchema, defaultOptions)
      expect(result).toBe(true)
    })

    it('debe retornar true con mezcla de campos indexados y no indexados', () => {
      const query = { _id: 'abc', cliente: 'ObjectId("xyz")' }
      const result = hasUnindexedFields(query, tsSchema, defaultOptions)
      expect(result).toBe(true)
    })

    it('debe reconocer campos por su mongoField', () => {
      const query = { total: '100', fecha_emision: '2024-01-01' }
      const result = hasUnindexedFields(query, tsSchema, defaultOptions)
      expect(result).toBe(false)
    })
  })

  describe('smartQuery with Typesense', () => {
    let TestModel: mongoose.Model<any>
    let mockSearch: jest.Mock

    beforeAll(() => {
      const schema = new mongoose.Schema({
        name: String,
        amount: Number,
      })
      schema.plugin(mongooseSmartQuery, {
        typesense: {
          schema: {
            name: 'test_collection',
            fields: [
              { name: 'id', type: 'string' },
              { name: 'name', type: 'string' },
            ],
          },
        },
      })
      TestModel = mongoose.model('TypesenseTest', schema)

      setTypesenseConfig({
        nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
        apiKey: 'xyz',
      })
    })

    beforeEach(() => {
      mockSearch = globalTypesenseClient!
        .collections('test_collection')
        .documents().search as jest.Mock
      mockSearch.mockClear()
    })

    it('debe retornar un array vacio SIN consultar MongoDB si Typesense devuelve 0 resultados', async () => {
      mockSearch.mockResolvedValueOnce({
        found: 0,
        hits: [],
      })

      // Espiamos aggregate para asegurar que NO se llame
      const aggregateSpy = jest.spyOn(TestModel, 'aggregate')

      const result = await (TestModel as any).smartQuery(
        { $q: 'no-existe' },
        { autoPaginate: false },
      )

      expect(mockSearch).toHaveBeenCalled()
      expect(aggregateSpy).not.toHaveBeenCalled()
      expect(result).toEqual([])

      aggregateSpy.mockRestore()
    })

    it('debe saltar Typesense y usar MongoDB cuando hay campos no indexados', async () => {
      const aggregateSpy = jest
        .spyOn(TestModel, 'aggregate')
        .mockResolvedValueOnce([
          { _id: '5f8d04f3b54764421b7156c1', name: 'Filtered' },
        ])

      const result = await (TestModel as any).smartQuery(
        { $q: 'test', unknownField: 'someValue' },
        { autoPaginate: false },
      )

      expect(mockSearch).not.toHaveBeenCalled()
      expect(aggregateSpy).toHaveBeenCalled()
      expect(result).toHaveLength(1)

      aggregateSpy.mockRestore()
    })

    it('debe filtrar en MongoDB usando los _id retornados por Typesense', async () => {
      mockSearch.mockResolvedValueOnce({
        found: 2,
        hits: [
          { document: { id: '5f8d04f3b54764421b7156c1' } },
          { document: { id: '5f8d04f3b54764421b7156c2' } },
        ],
      })

      let pipelinePassedToAggregate: any[] = []
      const aggregateSpy = jest
        .spyOn(TestModel, 'aggregate')
        .mockImplementation((pipeline) => {
          pipelinePassedToAggregate = pipeline as any[]
          return Promise.resolve([
            { _id: '5f8d04f3b54764421b7156c1', name: 'Found' },
          ]) as any
        })

      const result = await (TestModel as any).smartQuery(
        { $q: 'test' },
        { autoPaginate: false },
      )

      expect(result).toBeDefined()
      expect(mockSearch).toHaveBeenCalled()
      expect(aggregateSpy).toHaveBeenCalled()

      // El pipeline debe incluir el match con los _id devueltos por TS
      const matchStage = pipelinePassedToAggregate.find((stage) => stage.$match)
      expect(matchStage.$match._id.$in).toBeDefined()
      expect(matchStage.$match._id.$in).toHaveLength(2)

      aggregateSpy.mockRestore()
    })
  })

  describe('smartCount with Typesense', () => {
    let TestModel: mongoose.Model<any>
    let mockSearch: jest.Mock

    beforeAll(() => {
      const schema = new mongoose.Schema({
        name: String,
      })
      schema.plugin(mongooseSmartQuery, {
        typesense: {
          schema: {
            name: 'test_count',
            fields: [],
          },
        },
      })
      TestModel = mongoose.model('TypesenseCountTest', schema)
    })

    beforeEach(() => {
      mockSearch = globalTypesenseClient!.collections('test_count').documents()
        .search as jest.Mock
      mockSearch.mockClear()
    })

    it('debe devolver directamente el "found" de Typesense sin llamar a MongoDB', async () => {
      mockSearch.mockResolvedValueOnce({ found: 42 })

      const aggregateSpy = jest.spyOn(TestModel, 'aggregate')

      const count = await (TestModel as any).smartCount({ $q: 'hello' })

      expect(mockSearch).toHaveBeenCalled()
      expect(aggregateSpy).not.toHaveBeenCalled()
      expect(count).toBe(42)

      aggregateSpy.mockRestore()
    })

    it('debe saltar Typesense y usar MongoDB en smartCount cuando hay campos no indexados', async () => {
      const aggregateSpy = jest
        .spyOn(TestModel, 'aggregate')
        .mockResolvedValueOnce([{ size: 5 }])

      const count = await (TestModel as any).smartCount({
        $q: 'hello',
        cliente: 'ObjectId("abc")',
      })

      expect(mockSearch).not.toHaveBeenCalled()
      expect(aggregateSpy).toHaveBeenCalled()
      expect(count).toBe(5)

      aggregateSpy.mockRestore()
    })
  })
})
