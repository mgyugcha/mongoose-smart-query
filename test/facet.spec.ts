import mongooseSmartQuery from '../src/mongoose-smart-query'
import { Types, connect, Schema, model, connection, Document } from 'mongoose'

const dbname = 'mongoose-smart-query-facet-test'

// Setup
export default {
  async start() {
    const uri = `mongodb://127.0.0.1:27017/${dbname}`
    await connect(uri)

    // Clear existing
    try {
      await connection.dropDatabase()
    } catch (e) {}

    interface Person extends Document {
      name: string
      random: number
      birthday: Date
      colours: string[]
      password: string
      useLinux?: boolean
      bestFriend?: Types.ObjectId
      amigo: {
        bestFriend?: Types.ObjectId
      }
      searchString: string
    }
    const PersonSchema = new Schema<Person>({
      name: String,
      random: Number,
      birthday: Date,
      colours: [String],
      password: String,
      useLinux: Boolean,
      bestFriend: { type: Types.ObjectId, ref: 'persons' },
      amigo: {
        bestFriend: { type: Types.ObjectId, ref: 'persons' },
      },
      searchString: String,
    })
    PersonSchema.plugin(mongooseSmartQuery, {
      defaultFields: 'name',
      protectedFields: 'password',
      fieldsForDefaultQuery: 'name bestFriend.name',
      fieldsForDefaultSearch: ['searchString'],
    })

    // Cleanup if model exists from previous run in same process (jest quirk sometimes)
    if (connection.models['persons']) {
      delete (connection.models as any)['persons']
    }

    const Persons = model<Person>('persons', PersonSchema)
    await Persons.insertMany([
      {
        _id: '5cef28d32e950227cb5bfaa6',
        name: 'Michael Yugcha',
        random: 25,
        birthday: new Date('1993-09-27T05:00:00.000Z'),
        colours: ['blue', 'red', 'black'],
        password: '12345',
        useLinux: true,
        amigo: {
          bestFriend: '5cef28d32e950227cb5bfaa7',
        },
      },
      {
        _id: '5cef28d32e950227cb5bfaa7',
        name: 'Carlos Narvaez',
        random: 18,
        birthday: new Date('1995-01-12T05:00:00.000Z'),
        colours: ['yellow', 'red'],
        password: '12345',
        useLinux: false,
        bestFriend: '5cef28d32e950227cb5bfaa6',
      },
      {
        _id: '5cef28d32e950227cb5bfaa8',
        name: 'Luis Ñandú',
        random: 1,
        birthday: new Date('1984-04-07T05:00:00.000Z'),
        colours: ['pink', 'white'],
        password: '12345',
      },
      {
        _id: '5d0ceed6d0daeb2019a142f8',
        name: 'Marta Narvaez',
        random: 9,
        birthday: new Date('1993-04-01T05:00:00.000Z'),
        colours: ['pink', 'black'],
        password: '12345',
      },
    ])
    return Persons
  },
  async close() {
    await connection.dropDatabase()
    await connection.close()
  },
}

describe('mongoose-smart-query facet & prePipeline', () => {
  let Persons: any
  let db: any

  beforeAll(async () => {
    db = require('./facet.spec').default // Self import to access start/close
    Persons = await db.start()
  })

  afterAll(async () => {
    await db.close()
  })

  describe('Legacy Behavior', () => {
    it('returns array by default', async () => {
      const result = await Persons.smartQuery({})
      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(4)
    })
  })

  describe('useFacet: true', () => {
    it('returns structured result with pagination', async () => {
      const result = await Persons.smartQuery({}, { useFacet: true })

      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('pagination')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data).toHaveLength(4)
      expect(result.pagination).toEqual({
        total: 4,
        page: 1,
        pages: 1, // 4 items, default limit 20
        limit: 20, // defaultLimit
      })
    })

    it('pagination values limit', async () => {
      const result = await Persons.smartQuery(
        { $limit: '2', $page: '2' }, // Strings as usually in query params
        { useFacet: true },
      )
      expect(result.data).toHaveLength(2)
      expect(result.pagination).toMatchObject({
        total: 4,
        page: 2,
        pages: 2,
        limit: 2,
      })
      // Order is -_id by default (newest first).
      // IDs:
      // 5d0ceed6d0daeb2019a142f8 (Marta) -> 1
      // 5cef28d32e950227cb5bfaa8 (Luis) -> 2
      // 5cef28d32e950227cb5bfaa7 (Carlos) -> 3
      // 5cef28d32e950227cb5bfaa6 (Michael) -> 4

      // Page 2: Carlos, Michael.
      expect(result.data[0].name).toBe('Carlos Narvaez')
    })
  })

  describe('prePipeline', () => {
    it('applies prePipeline aggregation', async () => {
      // Find Michael Yugcha only
      const result = await Persons.smartQuery(
        {},
        {
          prePipeline: [{ $match: { name: 'Michael Yugcha' } }],
        },
      )
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Michael Yugcha')
    })

    it('combines prePipeline with facet', async () => {
      const result = await Persons.smartQuery(
        {},
        {
          prePipeline: [{ $match: { name: 'Michael Yugcha' } }],
          useFacet: true,
        },
      )
      expect(result.pagination.total).toBe(1)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('Michael Yugcha')
    })

    it('prePipeline grouping then facet', async () => {
      // Use $unwind in prePipeline
      const result = await Persons.smartQuery(
        {},
        {
          prePipeline: [{ $unwind: '$colours' }],
          useFacet: true,
          // Ensure we get all results
        },
      )
      // Total colours in seed: 3(Michael)+2(Carlos)+2(Luis)+2(Marta) = 9
      expect(result.pagination.total).toBe(9)
      expect(result.data).toHaveLength(9)
    })
  })
})
