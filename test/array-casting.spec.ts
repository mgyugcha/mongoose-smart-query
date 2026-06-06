import mongooseSmartQuery from '../src/'
import {
  Types,
  connect,
  Schema,
  SchemaTypes,
  model,
  connection,
  Document,
} from 'mongoose'

const dbname = 'mongoose-smart-query-array-casting-test'

const CAT_A = '66f2c29b4239037962d627cb'
const CAT_B = '66f2c29b4239037962d627cc'
const CAT_C = '66f2c29b4239037962d627cd'
const BIZ_X = '5f11f3afbeedc6269eb1bf0c'
const BIZ_Y = '5f11f3afbeedc6269eb1bf0d'

interface Product extends Document {
  name: string
  status: string
  type: string
  categorias: Types.ObjectId[]
  scores: number[]
  dates: Date[]
  labels: string[]
  business: Types.ObjectId
}

const buildProductSchema = () =>
  new Schema<Product>({
    name: String,
    status: String,
    type: String,
    categorias: [{ type: SchemaTypes.ObjectId, ref: 'categorias' }],
    scores: [Number],
    dates: [Date],
    labels: [String],
    business: { type: SchemaTypes.ObjectId, ref: 'businesses' },
  })

const getMatchStage = (pipeline: any[]) =>
  pipeline.find((stage) => stage.$match)?.$match ?? {}

describe('array casting — pipeline structure (offline)', () => {
  let Products: any

  beforeAll(() => {
    const ProductSchema = buildProductSchema()
    ProductSchema.plugin(mongooseSmartQuery, {
      defaultFields: 'name',
    })
    if (connection.models['products']) {
      delete (connection.models as any)['products']
    }
    Products = model<Product>('products', ProductSchema)
  })

  afterAll(async () => {
    if (connection.readyState !== 0) {
      await connection.close()
    }
  })

  it('casts match directo en array de ObjectId (caso upconta)', async () => {
    const { pipeline } = await Products.__smartQueryGetPipeline({
      categorias: CAT_A,
    })
    const match = getMatchStage(pipeline)
    expect(match.categorias).toBeInstanceOf(Types.ObjectId)
    expect(match.categorias.toString()).toBe(CAT_A)
  })

  it('casts match directo en ObjectId simple (regresión)', async () => {
    const { pipeline } = await Products.__smartQueryGetPipeline({
      business: BIZ_X,
    })
    const match = getMatchStage(pipeline)
    expect(match.business).toBeInstanceOf(Types.ObjectId)
    expect(match.business.toString()).toBe(BIZ_X)
  })

  it('casts $in en array de ObjectId', async () => {
    const { pipeline } = await Products.__smartQueryGetPipeline({
      categorias: `{$in}${CAT_A},${CAT_B}`,
    })
    const match = getMatchStage(pipeline)
    expect(Array.isArray(match.categorias.$in)).toBe(true)
    expect(match.categorias.$in).toHaveLength(2)
    for (const id of match.categorias.$in) {
      expect(id).toBeInstanceOf(Types.ObjectId)
    }
    expect(match.categorias.$in.map((id: Types.ObjectId) => id.toString())).toEqual(
      [CAT_A, CAT_B],
    )
  })

  it('casts $nin en array de ObjectId', async () => {
    const { pipeline } = await Products.__smartQueryGetPipeline({
      categorias: `{$nin}${CAT_A},${CAT_B}`,
    })
    const match = getMatchStage(pipeline)
    expect(match.categorias.$nin).toHaveLength(2)
    expect(match.categorias.$nin[0]).toBeInstanceOf(Types.ObjectId)
    expect(match.categorias.$nin[0].toString()).toBe(CAT_A)
    expect(match.categorias.$nin[1].toString()).toBe(CAT_B)
  })

  it('casts $in en array de Number', async () => {
    const { pipeline } = await Products.__smartQueryGetPipeline({
      scores: '{$in}10,20,30',
    })
    const match = getMatchStage(pipeline)
    expect(match.scores.$in).toEqual([10, 20, 30])
    for (const n of match.scores.$in) {
      expect(typeof n).toBe('number')
    }
  })

  it('casts $in en array de Date', async () => {
    const iso1 = '2024-01-01T00:00:00.000Z'
    const iso2 = '2024-02-01T00:00:00.000Z'
    const { pipeline } = await Products.__smartQueryGetPipeline({
      dates: `{$in}${iso1},${iso2}`,
    })
    const match = getMatchStage(pipeline)
    expect(match.dates.$in).toHaveLength(2)
    expect(match.dates.$in[0]).toBeInstanceOf(Date)
    expect(match.dates.$in[0].toISOString()).toBe(iso1)
    expect(match.dates.$in[1].toISOString()).toBe(iso2)
  })

  it('preserva strings en array de String (regresión)', async () => {
    const { pipeline } = await Products.__smartQueryGetPipeline({
      labels: '{$in}red,blue',
    })
    const match = getMatchStage(pipeline)
    expect(match.labels.$in).toEqual(['red', 'blue'])
  })

  it('casts match directo en array de Number', async () => {
    const { pipeline } = await Products.__smartQueryGetPipeline({
      scores: '5',
    })
    const match = getMatchStage(pipeline)
    expect(match.scores).toBe(5)
    expect(typeof match.scores).toBe('number')
  })

  it('campo inexistente se ignora sin error', async () => {
    const { pipeline } = await Products.__smartQueryGetPipeline({
      noExiste: 'cualquierCosa',
    })
    const match = getMatchStage(pipeline)
    expect(match).not.toHaveProperty('noExiste')
  })

  it('query combinada replica el caso reportado (upconta)', async () => {
    const { pipeline } = await Products.__smartQueryGetPipeline({
      categorias: CAT_A,
      status: 'active',
      business: BIZ_X,
      type: 'service',
    })
    const match = getMatchStage(pipeline)
    expect(match.categorias).toBeInstanceOf(Types.ObjectId)
    expect(match.categorias.toString()).toBe(CAT_A)
    expect(match.business).toBeInstanceOf(Types.ObjectId)
    expect(match.business.toString()).toBe(BIZ_X)
    expect(match.status).toBe('active')
    expect(match.type).toBe('service')
  })
})

describe('array casting — end-to-end con Mongo', () => {
  let Products: any

  beforeAll(async () => {
    const uri = `mongodb://127.0.0.1:27017/${dbname}`
    await connect(uri)
    try {
      await connection.dropDatabase()
    } catch {
      // ignore
    }

    const ProductSchema = buildProductSchema()
    ProductSchema.plugin(mongooseSmartQuery, {
      defaultFields: 'name',
    })
    if (connection.models['products']) {
      delete (connection.models as any)['products']
    }
    Products = model<Product>('products', ProductSchema)

    await Products.insertMany([
      {
        name: 'Servicio A',
        status: 'active',
        type: 'service',
        categorias: [new Types.ObjectId(CAT_A)],
        scores: [10, 20],
        dates: [new Date('2024-01-01T00:00:00.000Z')],
        labels: ['red', 'blue'],
        business: new Types.ObjectId(BIZ_X),
      },
      {
        name: 'Servicio B',
        status: 'active',
        type: 'service',
        categorias: [new Types.ObjectId(CAT_A), new Types.ObjectId(CAT_B)],
        scores: [20, 30],
        dates: [new Date('2024-02-01T00:00:00.000Z')],
        labels: ['green'],
        business: new Types.ObjectId(BIZ_X),
      },
      {
        name: 'Servicio C',
        status: 'inactive',
        type: 'service',
        categorias: [new Types.ObjectId(CAT_C)],
        scores: [40],
        dates: [new Date('2024-03-01T00:00:00.000Z')],
        labels: ['red'],
        business: new Types.ObjectId(BIZ_Y),
      },
      {
        name: 'Producto D',
        status: 'active',
        type: 'product',
        categorias: [new Types.ObjectId(CAT_B)],
        scores: [10],
        dates: [new Date('2024-01-15T00:00:00.000Z')],
        labels: ['blue'],
        business: new Types.ObjectId(BIZ_X),
      },
    ])
  })

  afterAll(async () => {
    try {
      await connection.dropDatabase()
    } catch {
      // ignore
    }
    await connection.close()
  })

  it('match directo por ObjectId en array (caso upconta)', async () => {
    const docs = await Products.smartQuery({
      categorias: CAT_A,
      status: 'active',
    })
    expect(docs).toHaveLength(2)
    const names = docs.map((d: any) => d.name).sort()
    expect(names).toEqual(['Servicio A', 'Servicio B'])
  })

  it('$in con múltiples ObjectIds en array', async () => {
    const docs = await Products.smartQuery({
      categorias: `{$in}${CAT_A},${CAT_B}`,
    })
    expect(docs).toHaveLength(3)
  })

  it('$nin con ObjectId en array', async () => {
    const docs = await Products.smartQuery({
      categorias: `{$nin}${CAT_A}`,
    })
    expect(docs).toHaveLength(2)
    const names = docs.map((d: any) => d.name).sort()
    expect(names).toEqual(['Producto D', 'Servicio C'])
  })

  it('$in con Numbers en array', async () => {
    const docs = await Products.smartQuery({ scores: '{$in}10,30' })
    expect(docs).toHaveLength(3)
  })

  it('$in con Dates en array', async () => {
    const docs = await Products.smartQuery({
      dates: '{$in}2024-01-01T00:00:00.000Z',
    })
    expect(docs).toHaveLength(1)
    expect(docs[0].name).toBe('Servicio A')
  })

  it('regresión: $in con Strings en array sigue funcionando', async () => {
    const docs = await Products.smartQuery({ labels: '{$in}red,blue' })
    // Servicio A: [red,blue] ✓ | Servicio B: [green] ✗ | Servicio C: [red] ✓ | Producto D: [blue] ✓ → 3
    expect(docs).toHaveLength(3)
  })

  it('smartCount consistente con smartQuery para el caso reportado', async () => {
    const query = {
      categorias: CAT_A,
      status: 'active',
      business: BIZ_X,
      type: 'service',
    }
    const docs = await Products.smartQuery(query)
    const count = await Products.smartCount(query)
    expect(count).toBe(docs.length)
    expect(count).toBe(2)
  })
})
