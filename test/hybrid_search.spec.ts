import mongooseSmartQuery from '../src/mongoose-smart-query'
import { connect, Schema, model, connection, Document } from 'mongoose'

const dbname = 'mongoose-smart-query-hybrid-test'

const db = {
  async start() {
    const uri = `mongodb://127.0.0.1:27017/${dbname}`
    await connect(uri)

    // Clear existing
    try {
      await connection.dropDatabase()
    } catch {
      // ignore
    }

    // 1. Schema WITH Text Index
    interface Post extends Document {
      title: string
      content: string
      tags: string[]
    }
    const PostSchema = new Schema<Post>({
      title: String,
      content: String,
      tags: [String],
    })
    PostSchema.index({ title: 'text', content: 'text' }, { name: 'TextIndex' })
    PostSchema.plugin(mongooseSmartQuery, {
      searchQueryName: '$q',
      fieldsForDefaultQuery: 'title content', // Fallback fields
      defaultFields: 'title content score', // Include score to verify it
    })

    // 2. Schema WITHOUT Text Index
    interface User extends Document {
      name: string
      email: string
    }
    const UserSchema = new Schema<User>({
      name: String,
      email: String,
    })
    UserSchema.plugin(mongooseSmartQuery, {
      searchQueryName: '$q',
      fieldsForDefaultQuery: 'name email',
    })

    if (connection.models['posts']) delete (connection.models as any)['posts']
    if (connection.models['users']) delete (connection.models as any)['users']

    const Posts = model<Post>('posts', PostSchema)
    const Users = model<User>('users', UserSchema)

    // Seeding
    await Posts.insertMany([
      {
        title: 'MongoDB Indexing',
        content: 'Text indexes are great for search.',
      },
      { title: 'Mongoose Plugins', content: 'Plugins extend functionality.' },
      { title: 'Search Engines', content: 'Elasticsearch is powerful.' },
    ])

    await Users.insertMany([
      { name: 'Michael', email: 'michael@example.com' },
      { name: 'Michelle', email: 'michelle@example.com' },
      { name: 'John', email: 'john@example.com' },
    ])

    return { Posts, Users }
  },
  async close() {
    await connection.dropDatabase()
    await connection.close()
  },
}

describe('mongoose-smart-query Hybrid Search', () => {
  let Posts: any
  let Users: any

  beforeAll(async () => {
    const models = await db.start()
    Posts = models.Posts
    Users = models.Users
  })

  afterAll(async () => {
    await db.close()
  })

  describe('Schema WITHOUT Text Index (Regex Fallback)', () => {
    it('uses regex for search', async () => {
      // Should find 'Michael' and 'Michelle' for query 'Mich'
      const result = await Users.smartQuery({ $q: 'Mich' })
      expect(result).toHaveLength(2)
      // Regex search usually doesn't add 'score' field unless we requested it manually (which we didn't)
      expect(result[0]).not.toHaveProperty('score')
    })
  })

  describe('Schema WITH Text Index ($text Search)', () => {
    it('uses $text search when available', async () => {
      // Search for "indexing"
      const result = await Posts.smartQuery({ $q: 'indexing' })
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('MongoDB Indexing')
      // Should have score projected
      expect(result[0]).toHaveProperty('score')
    })

    it('sorts by relevance (score)', async () => {
      await Posts.insertMany([
        { title: 'MongoDB', content: 'Just MongoDB' },
        { title: 'MongoDB Text', content: 'Text Search in MongoDB is useful' },
      ])

      // Query "MongoDB" should match all containing it.
      // "MongoDB" title might be more relevant or "MongoDB Text".
      // Actually "Just MongoDB" has "MongoDB" as 1/2 words?
      // Let's rely on the property that score exists and we can see it.
      const result = await Posts.smartQuery({ $q: 'MongoDB' })
      expect(result.length).toBeGreaterThan(1)
      expect(result[0]).toHaveProperty('score')

      // Verify sort order descending score
      const scores = result.map((r: any) => r.score)
      const sortedScores = [...scores].sort((a, b) => b - a)
      expect(scores).toEqual(sortedScores)
    })

    it('combines text search with useFacet', async () => {
      const result = await Posts.smartQuery(
        { $q: 'indexing' },
        { autoPaginate: true },
      )
      expect(result.pagination.total).toBe(1)
      expect(result.data[0].title).toBe('MongoDB Indexing')
      expect(result.data[0]).toHaveProperty('score')
    })
  })

  describe('Pipeline Inspection (Internal)', () => {
    it('generates $text stage for text index schema', async () => {
      const { pipeline } = await Posts.__smartQueryGetPipeline({ $q: 'search' })
      // Check if first stage is $match with $text
      // pipeline is [ { $match: { ... } }, ... ]
      // or [ { $match: { $text: ... } } ]

      const matchStage = pipeline.find((stage: any) => stage.$match)?.$match
      expect(matchStage).toBeDefined()
      expect(matchStage.$text).toBeDefined()
    })

    it('generates $regex stages for non-text index schema', async () => {
      const { pipeline } = await Users.__smartQueryGetPipeline({ $q: 'Mich' })
      const matchStage = pipeline.find((stage: any) => stage.$match)?.$match
      expect(matchStage).toBeDefined()
      expect(matchStage.$text).toBeUndefined()
      // Should have $or with regex on name/email
      expect(matchStage.$or).toBeDefined()
    })

    it('places $match before prePipeline', async () => {
      const prePipeline = [{ $addFields: { testField: 1 } }]
      const { pipeline } = await Users.__smartQueryGetPipeline(
        { $q: 'Mich' },
        false,
        prePipeline,
      )

      // Expected order:
      // 1. $match (from smartQuery logic)
      // 2. prePipeline stages

      expect(pipeline[0]).toHaveProperty('$match')
      expect(pipeline[1]).toHaveProperty('$addFields')
      expect(pipeline[1].$addFields.testField).toBe(1)
    })
  })
})
