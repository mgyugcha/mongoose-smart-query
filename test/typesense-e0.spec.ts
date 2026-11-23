import mongoose from 'mongoose'
import { Client } from 'typesense'
import mongooseSmartQuery, {
  globalTypesenseClient,
  setTypesenseConfig,
} from '../src'

jest.mock('typesense', () => {
  const actual = jest.requireActual('typesense') as typeof import('typesense')
  return {
    ...actual,
    Client: jest.fn().mockImplementation((options: any) => {
      // Real client so `configuration` reflects the installed typesense
      // version; only the search chain is mocked (no network).
      const client: any = new actual.Client({ ...options })
      const search = jest.fn().mockResolvedValue({ found: 0, hits: [] })
      const documents = { search }
      const chain = { documents: jest.fn(() => documents), search }
      client.collections = jest.fn(() => chain)
      client.search = search
      return client
    }),
  }
})

const ClientMock = Client as unknown as jest.Mock

const getSearchMock = (model: string): jest.Mock =>
  globalTypesenseClient!.collections(model).documents().search as unknown as jest.Mock

const lastCreatedClient = (): any => {
  const { results } = ClientMock.mock
  return results[results.length - 1].value
}

const baseConfig = {
  nodes: [{ host: 'localhost', port: 8108, protocol: 'http' as const }],
  apiKey: 'xyz',
}

describe('E0 Typesense options', () => {
  beforeAll(() => {
    setTypesenseConfig(baseConfig)
  })

  describe('activation opt-in', () => {
    let TestModel: mongoose.Model<any>
    let searchMock: jest.Mock
    let aggregateSpy: jest.SpyInstance

    beforeAll(() => {
      const schema = new mongoose.Schema({ name: String })
      schema.plugin(mongooseSmartQuery, {
        typesense: {
          activation: 'opt-in',
          schema: {
            name: 'e0_opt_in',
            fields: [
              { name: 'id', type: 'string' },
              { name: 'name', type: 'string' },
            ],
          },
        },
      })
      TestModel = mongoose.model('E0OptIn', schema)
      searchMock = getSearchMock('e0_opt_in')
    })

    beforeEach(() => {
      searchMock.mockReset()
      searchMock.mockResolvedValue({ found: 0, hits: [] })
      aggregateSpy = jest
        .spyOn(TestModel, 'aggregate')
        .mockResolvedValue([] as any)
    })

    afterEach(() => {
      aggregateSpy.mockRestore()
    })

    it('sin smartOptions.typesense usa MongoDB', async () => {
      const result = await (TestModel as any).smartQuery(
        { $q: 'test' },
        { autoPaginate: true },
      )

      expect(searchMock).not.toHaveBeenCalled()
      expect(aggregateSpy).toHaveBeenCalled()
      expect(result.data).toEqual([])
    })

    it('con typesense.enabled usa Typesense', async () => {
      await (TestModel as any).smartQuery(
        { $q: 'test' },
        { autoPaginate: true, typesense: { enabled: true } },
      )

      expect(searchMock).toHaveBeenCalled()
      expect(aggregateSpy).not.toHaveBeenCalled()
    })

    it('con typesense.enabled false usa MongoDB', async () => {
      await (TestModel as any).smartQuery(
        { $q: 'test' },
        { autoPaginate: true, typesense: { enabled: false } },
      )

      expect(searchMock).not.toHaveBeenCalled()
      expect(aggregateSpy).toHaveBeenCalled()
    })

    it('smartCount respeta opt-in y su segundo parámetro', async () => {
      aggregateSpy.mockResolvedValueOnce([{ size: 7 }] as any)

      const withoutOptIn = await (TestModel as any).smartCount({ $q: 'test' })
      expect(searchMock).not.toHaveBeenCalled()
      expect(withoutOptIn).toBe(7)

      searchMock.mockResolvedValueOnce({ found: 12 })
      const withOptIn = await (TestModel as any).smartCount(
        { $q: 'test' },
        { typesense: { enabled: true } },
      )
      expect(searchMock).toHaveBeenCalled()
      expect(withOptIn).toBe(12)
    })
  })

  describe('clientOptions por modelo', () => {
    let TestModel: mongoose.Model<any>

    beforeAll(() => {
      const schema = new mongoose.Schema({ name: String })
      schema.plugin(mongooseSmartQuery, {
        typesense: {
          schema: {
            name: 'e0_client_options',
            fields: [{ name: 'id', type: 'string' }],
          },
          clientOptions: {
            connectionTimeoutSeconds: 0.8,
            numRetries: 0,
            apiKey: 'search-only',
          },
        },
      })
      TestModel = mongoose.model('E0ClientOptions', schema)
    })

    it('crea un cliente propio cacheado con la config global + overrides', async () => {
      ClientMock.mockClear()

      await (TestModel as any).smartQuery(
        { $q: 'test' },
        { autoPaginate: true, typesense: { enabled: true } },
      )

      expect(ClientMock).toHaveBeenCalledTimes(1)
      expect(ClientMock).toHaveBeenCalledWith({
        ...baseConfig,
        connectionTimeoutSeconds: 0.8,
        numRetries: 0,
        apiKey: 'search-only',
      })

      const searchMock = lastCreatedClient().search as jest.Mock
      expect(searchMock).toHaveBeenCalledTimes(1)

      // Reutiliza el cliente creado en la siguiente llamada.
      await (TestModel as any).smartQuery(
        { $q: 'test' },
        { autoPaginate: true, typesense: { enabled: true } },
      )
      expect(ClientMock).toHaveBeenCalledTimes(1)
    })

    it('respeta numRetries: 0 con el cliente real de typesense', async () => {
      const schema = new mongoose.Schema({ name: String })
      schema.plugin(mongooseSmartQuery, {
        typesense: {
          schema: {
            name: 'e0_num_retries',
            fields: [{ name: 'id', type: 'string' }],
          },
          clientOptions: { numRetries: 0 },
        },
      })
      const Model = mongoose.model('E0NumRetries', schema)
      const aggregateSpy = jest
        .spyOn(Model, 'aggregate')
        .mockResolvedValue([] as any)
      ClientMock.mockClear()

      await (Model as any).smartQuery(
        { $q: 'test' },
        { autoPaginate: true, typesense: { enabled: true } },
      )

      const client = lastCreatedClient()
      expect(ClientMock).toHaveBeenCalledTimes(1)
      expect(client.configuration.numRetries).toBe(0)
      expect(client.search).toHaveBeenCalledTimes(1)

      aggregateSpy.mockRestore()
    })
  })

  describe('filterBy y searchParameters por llamada', () => {
    let TestModel: mongoose.Model<any>
    let searchMock: jest.Mock
    let aggregateSpy: jest.SpyInstance

    beforeAll(() => {
      const schema = new mongoose.Schema({ name: String })
      schema.plugin(mongooseSmartQuery, {
        typesense: {
          schema: {
            name: 'e0_call_options',
            fields: [
              { name: 'id', type: 'string' },
              { name: 'business', type: 'string' },
              { name: 'code', type: 'string', sort: true },
            ],
          },
          searchParameters: { prefix: false, num_typos: '2' },
        },
      })
      TestModel = mongoose.model('E0CallOptions', schema)
      searchMock = getSearchMock('e0_call_options')
    })

    beforeEach(() => {
      searchMock.mockReset()
      searchMock.mockResolvedValue({ found: 0, hits: [] })
      aggregateSpy = jest
        .spyOn(TestModel, 'aggregate')
        .mockResolvedValue([] as any)
    })

    afterEach(() => {
      aggregateSpy.mockRestore()
    })

    it('une filterBy con && y aplica searchParameters al final', async () => {
      const sortBy =
        '_eval(codesExact:=[`a-001`]):desc,_text_match:desc,code:asc'

      await (TestModel as any).smartQuery(
        { $q: 'a001', business: 'b1' },
        {
          autoPaginate: false,
          typesense: {
            filterBy: '(status:=active || status:=draft) && tags:=[`b1`,`b2`]',
            searchParameters: {
              sort_by: sortBy,
              q: 'a001',
              num_typos: '0,2,2,2',
            },
          },
        },
      )

      expect(searchMock).toHaveBeenCalledTimes(1)
      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'a001',
          filter_by:
            '(business:=b1) && ((status:=active || status:=draft) && tags:=[`b1`,`b2`])',
          sort_by: sortBy,
          prefix: false,
          num_typos: '0,2,2,2',
        }),
      )
    })

    it('conserva el filtro generado ante un || de nivel superior', async () => {
      await (TestModel as any).smartQuery(
        { $q: 'test', business: 'b1' },
        {
          autoPaginate: false,
          typesense: { filterBy: 'status:=active || status:=draft' },
        },
      )

      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          filter_by: '(business:=b1) && (status:=active || status:=draft)',
        }),
      )
    })

    it('une searchParameters.filter_by al filtro generado', async () => {
      await (TestModel as any).smartQuery(
        { $q: 'test', business: 'b1' },
        {
          autoPaginate: false,
          typesense: {
            searchParameters: {
              filter_by: 'status:=active || status:=draft',
            },
          },
        },
      )

      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          filter_by: '(business:=b1) && (status:=active || status:=draft)',
        }),
      )
    })

    it('sin filtros adicionales conserva el filtro generado sin cambios', async () => {
      await (TestModel as any).smartQuery(
        { $q: 'test', business: 'b1' },
        { autoPaginate: false },
      )

      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({ filter_by: 'business:=b1' }),
      )
    })

    it('aplica filterBy también en smartCount', async () => {
      searchMock.mockResolvedValueOnce({ found: 3 })

      const count = await (TestModel as any).smartCount(
        { $q: 'test', business: 'b1' },
        { typesense: { filterBy: 'status:=active' } },
      )

      expect(count).toBe(3)
      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          filter_by: '(business:=b1) && (status:=active)',
        }),
      )
    })
  })

  describe('log de fallo de Typesense', () => {
    let searchMock: jest.Mock
    let errorSpy: jest.SpyInstance
    let aggregateSpies: jest.SpyInstance[] = []
    let modelCounter = 0

    const createModel = (): {
      model: mongoose.Model<any>
      collection: string
    } => {
      const collection = `e0_log_${++modelCounter}`
      const schema = new mongoose.Schema({ name: String })
      schema.plugin(mongooseSmartQuery, {
        typesense: {
          schema: {
            name: collection,
            fields: [{ name: 'id', type: 'string' }],
          },
        },
      })
      return {
        model: mongoose.model(`E0Log${modelCounter}`, schema),
        collection,
      }
    }

    const spyAggregate = (model: mongoose.Model<any>) => {
      const spy = jest.spyOn(model, 'aggregate').mockResolvedValue([] as any)
      aggregateSpies.push(spy)
    }

    beforeAll(() => {
      searchMock = getSearchMock('e0_log')
    })

    beforeEach(() => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      searchMock.mockReset()
      searchMock.mockResolvedValue({ found: 0, hits: [] })
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
      aggregateSpies.forEach((spy) => spy.mockRestore())
      aggregateSpies = []
      errorSpy.mockRestore()
      jest.useRealTimers()
    })

    it('loguea una línea sin API key ni el objeto de error', async () => {
      const { model, collection } = createModel()
      spyAggregate(model)
      const apiKey = 'secret-typesense-api-key'
      const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8108'), {
        code: 'ECONNREFUSED',
        config: { headers: { 'X-TYPESENSE-API-KEY': apiKey } },
      })
      searchMock.mockRejectedValueOnce(error)

      const result = await (model as any).smartQuery(
        { $q: 'test' },
        { autoPaginate: true },
      )

      expect(result.data).toEqual([])
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy.mock.calls[0]).toHaveLength(1)

      const log = errorSpy.mock.calls[0][0] as string
      expect(typeof log).toBe('string')
      expect(log).toContain('[mongoose-smart-query]')
      expect(log).toContain(collection)
      expect(log).toContain('ECONNREFUSED')
      expect(log).toContain('usando MongoDB')
      expect(log).not.toContain(apiKey)
      expect(log).not.toContain('X-TYPESENSE-API-KEY')
      expect(log).not.toContain('\n')
    })

    it('no loguea una segunda falla dentro del minuto y sigue intentando Typesense', async () => {
      const { model } = createModel()
      spyAggregate(model)
      const error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
      searchMock.mockRejectedValueOnce(error).mockRejectedValueOnce(error)

      await (model as any).smartQuery({ $q: 'test' }, { autoPaginate: true })
      expect(errorSpy).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(30000)
      await (model as any).smartQuery({ $q: 'test' }, { autoPaginate: true })

      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(searchMock).toHaveBeenCalledTimes(2)
    })

    it('vuelve a loguear tras el minuto', async () => {
      const { model } = createModel()
      spyAggregate(model)
      const error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
      searchMock.mockRejectedValueOnce(error).mockRejectedValueOnce(error)

      await (model as any).smartQuery({ $q: 'test' }, { autoPaginate: true })
      expect(errorSpy).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(60001)
      await (model as any).smartQuery({ $q: 'test' }, { autoPaginate: true })

      expect(errorSpy).toHaveBeenCalledTimes(2)
    })

    it('un 400 loguea cada vez con el texto de rechazo', async () => {
      const { model, collection } = createModel()
      spyAggregate(model)
      const apiKey = 'secret-typesense-api-key'
      const badRequest = () =>
        Object.assign(
          new Error('Bad Request: filter_by is invalid ?filter_by=broken'),
          {
            httpStatus: 400,
            config: { headers: { 'X-TYPESENSE-API-KEY': apiKey } },
          },
        )
      searchMock
        .mockRejectedValueOnce(badRequest())
        .mockRejectedValueOnce(badRequest())

      await (model as any).smartQuery({ $q: 'test' }, { autoPaginate: true })
      expect(errorSpy).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(30000)
      await (model as any).smartQuery({ $q: 'test' }, { autoPaginate: true })

      expect(errorSpy).toHaveBeenCalledTimes(2)
      expect(searchMock).toHaveBeenCalledTimes(2)

      const log = errorSpy.mock.calls[1][0] as string
      expect(log).toContain('[mongoose-smart-query]')
      expect(log).toContain('Typesense rechazó la consulta en')
      expect(log).toContain(collection)
      expect(log).toContain('HTTP 400')
      expect(log).toContain('usando MongoDB')
      expect(log).not.toContain(apiKey)
      expect(log).not.toContain('X-TYPESENSE-API-KEY')
      expect(log).not.toContain('?filter_by')
    })

    it('un 503 mantiene el throttle de disponibilidad', async () => {
      const { model } = createModel()
      spyAggregate(model)
      const unavailable = Object.assign(new Error('Service Unavailable'), {
        httpStatus: 503,
      })
      searchMock
        .mockRejectedValueOnce(unavailable)
        .mockRejectedValueOnce(unavailable)

      await (model as any).smartQuery({ $q: 'test' }, { autoPaginate: true })
      expect(errorSpy).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(30000)
      await (model as any).smartQuery({ $q: 'test' }, { autoPaginate: true })

      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(searchMock).toHaveBeenCalledTimes(2)

      const log = errorSpy.mock.calls[0][0] as string
      expect(log).toContain('Typesense no disponible en')
      expect(log).toContain('HTTP 503')
    })
  })
})
