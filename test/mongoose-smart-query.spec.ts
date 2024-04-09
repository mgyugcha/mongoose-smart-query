import Database, { getPersonModel } from './load-database'
import {
  removeKeys,
  stringToQuery,
  getListOfPossibleLookups,
} from '../dist/mongoose-smart-query'

describe('list of possible lookups', () => {
  it('a single nested field', () => {
    expect(
      getListOfPossibleLookups({
        client: { id: 1, name: 1 },
      }),
    ).toEqual(['client'])
  })

  it('multiple nested fields', () => {
    expect(
      getListOfPossibleLookups({
        client: { id: 1, name: 1 },
        provider: { id: 1, name: 1 },
      }),
    ).toEqual(['client', 'provider'])
  })

  it('nested on two levels', () => {
    expect(
      getListOfPossibleLookups({
        client: { id: 1, name: 1, provider: { id: 1, name: 1 } },
      }),
    ).toEqual(['client', 'client.provider'])
  })

  it('another way: client.name', () => {
    expect(
      getListOfPossibleLookups({
        'client.name': 1,
      }),
    ).toEqual(['client'])
  })
})

describe('string to object', () => {
  it('name friends { name }', () => {
    expect(stringToQuery('name friends { name }')).toEqual({
      name: 1,
      friends: { name: 1 },
    })
  })

  it('friends.name friends.friend.name', () => {
    expect(stringToQuery('friends.name friends.friend.name')).toEqual({
      'friends.name': 1,
      'friends.friend.name': 1,
    })
  })

  it('friends { name } nextFriends { friend { name } }', () => {
    expect(
      stringToQuery('friends { name } nextFriends { friend { name } }'),
    ).toEqual({
      friends: { name: 1 },
      nextFriends: {
        friend: { name: 1 },
      },
    })
  })
})

describe('remove keys from object', () => {
  it('simple remove', () => {
    const result = removeKeys({ name: 1, surname: 1 }, { surname: 1 })
    expect(result).toEqual({ name: 1 })
  })

  it('remove partial nested object', () => {
    const result = removeKeys(
      {
        name: 1,
        friend: { name: 1, surname: 1 },
      },
      { friend: { surname: 1 } },
    )
    expect(result).toEqual({ name: 1, friend: { name: 1 } })
  })

  it('remove complete nested object', () => {
    const result = removeKeys(
      {
        name: 1,
        friend: { name: 1, surname: 1 },
      },
      { friend: 1 },
    )
    expect(result).toEqual({ name: 1 })
  })

  it('remove all keys from nested object', () => {
    const result = removeKeys(
      {
        name: 1,
        friend: { name: 1, surname: 1 },
      },
      { friend: { name: 1, surname: 1 } },
    )
    expect(result).toEqual({ name: 1 })
  })
})

describe('mongoose-smart-query', () => {
  let Persons: any

  beforeAll(async () => {
    await Database.start()
    Persons = getPersonModel()
  })

  afterAll(() => Database.close())

  describe('pipeline', () => {
    it('sort', async () => {
      const { pipeline } = await Persons.__smartQueryGetPipeline({
        $sort: '-_id',
        $fields: 'name bestFriend { name random }',
      })
      expect(pipeline).toHaveLength(4)
      expect(pipeline[0]).toHaveProperty('$sort')
    })
  })

  describe('$limit', () => {
    it('limit to 2 results', async () => {
      const docs = await Persons.smartQuery({ $limit: 2 })
      expect(docs).toHaveLength(2)
    })
  })

  describe('$limit and $page', () => {
    it('get data per page 1', async () => {
      const docs = await Persons.smartQuery({ $limit: 1, $page: 1 })
      expect(docs).toHaveLength(1)
      expect(docs[0].name).toEqual('Marta Narvaez')
    })

    it('get data per $limit:2 & $page:2', async () => {
      const docs = await Persons.smartQuery({ $limit: 2, $page: 2 })
      expect(docs).toHaveLength(2)
      expect(docs[0].name).toEqual('Carlos Narvaez')
    })
  })

  describe('$fields', () => {
    it('with default args', async () => {
      const docs = await Persons.smartQuery()
      expect(docs).toHaveLength(4)
      expect(Object.keys(docs[0]).sort()).toEqual(['_id', 'name'].sort())
    })

    it('get only random and birthday', async () => {
      const docs = await Persons.smartQuery({ $fields: 'random birthday' })
      expect(docs).toHaveLength(4)
      expect(Object.keys(docs[0]).sort()).toEqual(
        ['_id', 'random', 'birthday'].sort(),
      )
    })

    it('try to get protected fields', async () => {
      const docs = await Persons.smartQuery({ $fields: 'name password' })
      expect(docs).toHaveLength(4)
      expect(Object.keys(docs[0]).sort()).toEqual(['_id', 'name'].sort())
    })
  })

  describe('$unwind', () => {
    it('unwind colours', async () => {
      const docs = await Persons.smartQuery({ $unwind: 'colours' })
      expect(docs).toHaveLength(9)
    })

    it('unwind nonexistent field', async () => {
      const docs = await Persons.smartQuery({ $unwind: 'viernes' })
      expect(docs).toHaveLength(4)
    })
  })

  describe('$q', () => {
    it('simple query', async () => {
      const docs = await Persons.smartQuery({ $q: 'michael' })
      expect(docs).toHaveLength(2)
    })

    it('specials characters', async () => {
      const docs = await Persons.smartQuery({ $q: 'ñandú' })
      expect(docs).toHaveLength(1)
    })
    it('more specials character', async () => {
      const docs = await Persons.smartQuery({ $q: "{)(&^%$][{}'.,;`~|/^" })
      expect(docs).toHaveLength(0)
    })
    it('regex characters', async () => {
      const docs = await Persons.smartQuery({ $q: '*Yugcha' })
      expect(docs).toHaveLength(2)
    })
    it('special and character', async () => {
      const docs = await Persons.smartQuery({ $q: '\\' })
      expect(docs).toHaveLength(4)
    })
  })

  describe('nested documents', () => {
    it('get with $lookup', async () => {
      const docs = await Persons.smartQuery({
        $fields: 'name bestFriend { name random }',
      })
      expect(docs).toHaveLength(4)
      expect(Object.keys(docs[2]).sort()).toEqual(
        ['_id', 'name', 'bestFriend'].sort(),
      )
      expect(Object.keys(docs[2].bestFriend).sort()).toEqual(
        ['_id', 'name', 'random'].sort(),
      )
    })

    it('get with $lookup without spaces: "bestFriend{name}"', async () => {
      const docs = await Persons.smartQuery({
        $fields: 'name bestFriend{name random}',
      })
      expect(docs).toHaveLength(4)
      expect(Object.keys(docs[2]).sort()).toEqual(
        ['_id', 'name', 'bestFriend'].sort(),
      )
      expect(Object.keys(docs[2].bestFriend).sort()).toEqual(
        ['_id', 'name', 'random'].sort(),
      )
    })
  })

  describe('match directly', () => {
    it('casting number and nonexistent value', async () => {
      const docs = await Persons.smartQuery({
        random: '18',
        mgyugcha: 'imnoreal',
      })
      expect(docs).toHaveLength(1)
      expect(docs[0].name).toEqual('Carlos Narvaez')
    })
  })

  describe('match boolean', () => {
    it('casting ', async () => {
      const docs = await Persons.smartQuery({ useLinux: true })
      expect(docs).toHaveLength(1)
      expect(docs[0].name).toEqual('Michael Yugcha')
    })
  })

  describe('match with operators', () => {
    describe('match $exists', () => {
      it('true', async () => {
        const docs = await Persons.smartQuery({ bestFriend: '{$exists}true' })
        expect(docs).toHaveLength(1)
      })

      it('false', async () => {
        const docs = await Persons.smartQuery({ bestFriend: '{$exists}false' })
        expect(docs).toHaveLength(3)
      })
    })

    describe('$includes', () => {
      it('search inside field', async () => {
        const docs = await Persons.smartQuery({ name: '{$includes}narvaez' })
        expect(docs).toHaveLength(2)
      })
    })

    describe('$in', () => {
      it('buscar en campo de string', async () => {
        const docs = await Persons.smartQuery({ colours: '{$in}red' })
        expect(docs).toHaveLength(2)
      })

      it('buscar en campo de número', async () => {
        const docs = await Persons.smartQuery({ random: '{$in}18 ,1' })
        expect(docs).toHaveLength(2)
      })

      it('buscar por ObjectId', async () => {
        const docs = await Persons.smartQuery({
          _id: '{$nin}5cef28d32e950227cb5bfaa6,5cef28d32e950227cb5bfaa7',
        })
        expect(docs).toHaveLength(2)
      })
    })

    describe('with numbers', () => {
      it('operator $gt', async () => {
        const docs = await Persons.smartQuery({ random: '{$gt}18' })
        expect(docs).toHaveLength(1)
      })
      it('operator $gte', async () => {
        const docs = await Persons.smartQuery({ random: '{$gte}18' })
        expect(docs).toHaveLength(2)
      })
      it('operator $lt', async () => {
        const docs = await Persons.smartQuery({ random: '{$lt}18' })
        expect(docs).toHaveLength(2)
      })
      it('operator $lte', async () => {
        const docs = await Persons.smartQuery({ random: '{$lte}18' })
        expect(docs).toHaveLength(3)
      })
      it('operator $gte and $lt', async () => {
        const docs = await Persons.smartQuery({ random: '{$gte}1{$lt}18' })
        expect(docs).toHaveLength(2)
      })
      it('operator $gte and $lte', async () => {
        const docs = await Persons.smartQuery({ random: '{$gte}1{$lte}18' })
        expect(docs).toHaveLength(3)
      })
    })

    describe('with date', () => {
      it('operator $gt', async () => {
        const docs = await Persons.smartQuery({
          birthday: '{$gt}1993-04-01T05:00:00.000Z',
        })
        expect(docs).toHaveLength(2)
      })
      it('operator $gte', async () => {
        const docs = await Persons.smartQuery({
          birthday: '{$gte}1993-04-01T05:00:00.000Z',
        })
        expect(docs).toHaveLength(3)
      })
      it('operator $gte and $lte', async () => {
        const docs = await Persons.smartQuery({
          birthday:
            '{$gte}1993-09-27T05:00:00.000Z{$lte}1995-01-12T05:00:00.000Z',
        })
        expect(docs).toHaveLength(2)
      })
    })
  })

  describe('multiple match', () => {
    it('$sort $fields $page', async () => {
      const docs = await Persons.smartQuery({
        $sort: '-random',
        $page: 2,
        fields: 'name password',
        $limit: 1,
      })
      expect(docs).toHaveLength(1)
      expect(docs[0].name).toEqual('Carlos Narvaez')
    })

    it('get sorted results', async () => {
      const docs = await Persons.smartQuery({
        $sort: 'random',
        $fields: 'random',
      })
      expect(docs[0]._id.toString()).toEqual('5cef28d32e950227cb5bfaa8')
      expect(docs[1]._id.toString()).toEqual('5d0ceed6d0daeb2019a142f8')
      expect(docs[2]._id.toString()).toEqual('5cef28d32e950227cb5bfaa7')
      expect(docs[3]._id.toString()).toEqual('5cef28d32e950227cb5bfaa6')
    })

    it('get matched field in $lookup', async () => {
      const docs = await Persons.smartQuery({
        'bestFriend.random': 25,
        $fields: 'name random bestFriend { name random }',
      })
      expect(docs).toHaveLength(1)
      expect(Object.keys(docs[0]).sort()).toEqual(
        ['_id', 'name', 'random', 'bestFriend'].sort(),
      )
      expect(docs[0]).toHaveProperty('name', 'Carlos Narvaez')
      expect(docs[0]).toHaveProperty('random', 18)
      expect(docs[0].bestFriend).toHaveProperty('name', 'Michael Yugcha')
      expect(docs[0].bestFriend).toHaveProperty('random', 25)
    })

    it('lookup and nested unwind', async () => {
      const docs = await Persons.smartQuery({
        $fields: 'bestFriend { name colours }',
        $unwind: 'bestFriend.colours',
      })
      expect(docs).toHaveLength(6)
    })

    it('get with $q and $lookup', async () => {
      const docs = await Persons.smartQuery({
        $q: 'narvaez',
        $fields: 'name bestFriend { name }',
      })
      expect(docs).toHaveLength(2)
      expect(docs[1]).toHaveProperty('_id')
      expect(docs[1]).toHaveProperty('name')
      expect(docs[1]).toHaveProperty('bestFriend.name')
    })

    it('$lookup as bestFriend.name ', async () => {
      const docs = await Persons.smartQuery({
        $fields: 'name bestFriend.name',
      })
      expect(docs).toHaveLength(4)
      expect(docs[2]).toHaveProperty('_id')
      expect(docs[2]).toHaveProperty('bestFriend.name')
    })

    it('query without args', async () => {
      const docs = await Persons.smartQuery()
      expect(docs).toHaveLength(4)
    })
  })

  describe('count', () => {
    it('simple counter', async () => {
      const size = await Persons.smartCount()
      expect(size).toEqual(4)
    })

    it('query with nonexistent field', async () => {
      const size = await Persons.smartCount({ egg: 'easter' })
      expect(size).toEqual(4)
    })

    it('query without results', async () => {
      const size = await Persons.smartCount({ name: 'Geovanny' })
      expect(size).toEqual(0)
    })

    it('with $unwind', async () => {
      const size = await Persons.smartCount({ $unwind: 'colours' })
      expect(size).toEqual(9)
    })
  })

  describe('$getAllFields', () => {
    it('obtener todos los campos', async () => {
      const [doc] = await Persons.smartQuery({
        _id: '5cef28d32e950227cb5bfaa6',
        $getAllFields: 'true',
      })
      expect(doc).toHaveProperty('name')
      expect(doc).toHaveProperty('random')
      expect(doc).toHaveProperty('birthday')
      expect(doc).toHaveProperty('colours')
      expect(doc).not.toHaveProperty('password')
      expect(doc).toHaveProperty('useLinux')
    })
  })

  describe('operator $or', () => {
    it('búsqueda con $or', async () => {
      const docs = await Persons.smartQuery({
        random: '{$or}25',
        name: '{$or}Luis Ñandú',
      })
      expect(docs).toHaveLength(2)
    })
    it('búsqueda con $or y $q', async () => {
      const docs = await Persons.smartQuery({
        $q: 'Yugcha',
        name: '{$or}Luis Ñandú',
      })
      expect(docs).toHaveLength(3)
    })
  })
})
