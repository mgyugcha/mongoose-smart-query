import Database, { getPersonModel } from '../test-utils/load-database'
import {
  removeKeys,
  stringToQuery,
  getListOfPossibleLookups,
} from './mongoose-smart-query'

describe('list of possible lookups', () => {
  it('a single nested field', () => {
    expect(getListOfPossibleLookups({
      client: { id: 1, name: 1 }
    })).toEqual(['client'])
  })
  it('multiple nested fields', () => {
    expect(getListOfPossibleLookups({
      client: { id: 1, name: 1 },
      provider: { id: 1, name: 1 },
    })).toEqual(['client', 'provider'])
  })
  it('nested on two levels', () => {
    expect(getListOfPossibleLookups({
      client: { id: 1, name: 1, provider: { id: 1, name: 1 } },
    })).toEqual(['client', 'client.provider'])
  })
})

describe('string to object', () => {
  it('name friends { name }', () => {
    expect(stringToQuery('name friends { name }')).toEqual({
      name: 1, friends: { name: 1 }
    })
  })

  it('friends.name friends.friend.name', () => {
    expect(stringToQuery('friends.name friends.friend.name')).toEqual({
      'friends.name': 1, 'friends.friend.name': 1
    })
  })

  it('friends { name } nextFriends { friend { name } }', () => {
    expect(stringToQuery('friends { name } nextFriends { friend { name } }')).toEqual({
      friends: { name: 1 },
      nextFriends: {
        friend: { name: 1 }
      }
    })
  })
})

describe('remove keys from object', () => {
  it ('simple remove', () => {
    const result = removeKeys({ name: 1, surname: 1 }, { surname: 1 })
    expect(result).toEqual({ name: 1 })
  })

  it ('remove partial nested object', () => {
    const result = removeKeys({
      name: 1,
      friend: { name: 1, surname: 1 }
    }, { friend: { surname: 1 } })
    expect(result).toEqual({ name: 1, friend: { name: 1 } })
  })

  it ('remove complete nested object', () => {
    const result = removeKeys({
      name: 1,
      friend: { name: 1, surname: 1 }
    }, { friend: 1 })
    expect(result).toEqual({ name: 1 })
  })

  it ('remove all keys from nested object', () => {
    const result = removeKeys({
      name: 1,
      friend: { name: 1, surname: 1 }
    }, { friend: { name: 1, surname: 1 } })
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

  describe('GET all', () => {
    it('get with $q and $lookup', async () => {
      const docs = await Persons.smartQuery()
      // console.log(docs)
      // expect(docs).toHaveLength(2)
      // expect(docs[1]).toHaveProperty('_id')
      // expect(docs[1]).toHaveProperty('name')
      // expect(docs[1]).toHaveProperty('bestFriend')
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
    it('with default args', async  () => {
      const docs = await Persons.smartQuery()
      expect(docs).toHaveLength(4)
      expect(Object.keys(docs[0]).sort())
        .toEqual(['_id', 'name'].sort())
    })
  
    it('get only random and birthday', async () => {
      const docs = await Persons.smartQuery({ $fields: 'random birthday' })
      expect(docs).toHaveLength(4)
      expect(Object.keys(docs[0]).sort())
        .toEqual(['_id', 'random', 'birthday'].sort())
    })
  
    it('try to get protected fields', async () => {
      const docs = await Persons.smartQuery({ $fields: 'name password' })
      expect(docs).toHaveLength(4)
      expect(Object.keys(docs[0]).sort())
        .toEqual(['_id', 'name'].sort())
    })
  })

  describe.only('$unwind', () => {
    it('unwind colours', async () => {
      const docs = await Persons.smartQuery({ $unwind: 'colours' })
      expect(docs).toHaveLength(9)
    })
  })

  describe('$q', () => {
    it('simple query', async () => {
      const docs = await Persons.smartQuery({ $q: 'michael' })
      expect(docs).toHaveLength(1)
    })
  })

  describe('complex operations', () => {
    it('get with $lookup', async () => {
      const docs = await Persons.smartQuery({ $fields: 'name bestFriend { name random }' })
      expect(docs).toHaveLength(4)
      expect(Object.keys(docs[2]).sort())
        .toEqual(['_id', 'name', 'bestFriend'].sort())
      expect(Object.keys(docs[2].bestFriend).sort())
        .toEqual(['name', 'random'].sort())
    })
  
    it('get with $lookup without spaces: "bestFriend{name}"', async () => {
      const docs = await Persons.smartQuery({ $fields: 'name bestFriend{name random}' })
      expect(docs).toHaveLength(4)
      expect(Object.keys(docs[2]).sort())
        .toEqual(['_id', 'name', 'bestFriend'].sort())
      expect(Object.keys(docs[2].bestFriend).sort())
        .toEqual(['name', 'random'].sort())
    })
  })

  describe('match directly', () => {
    it ('casting number and nonexistent value', async () => {
      const docs = await Persons.smartQuery({ random: '18', mgyugcha: 'imnoreal' })
      expect(docs).toHaveLength(1)
      expect(docs[0].name).toEqual('Carlos Narvaez')
    })
  })

  describe('multiple match', () => {
    it ('$sort $fields $page', async () => {
      const docs = await Persons.smartQuery({
        $sort: '-random', $page: 2, fields: 'name password', $limit: 1
      })
      expect(docs).toHaveLength(1)
      expect(docs[0].name).toEqual('Carlos Narvaez')
    })

    it('get sorted results', async () => {
      const docs = await Persons.smartQuery({ $sort: 'random', $fields: 'random' })
      expect(docs[0]._id.toString()).toEqual('5cef28d32e950227cb5bfaa8')
      expect(docs[1]._id.toString()).toEqual('5d0ceed6d0daeb2019a142f8')
      expect(docs[2]._id.toString()).toEqual('5cef28d32e950227cb5bfaa7')
      expect(docs[3]._id.toString()).toEqual('5cef28d32e950227cb5bfaa6')
    })

    it('get matched field in $lookup', async () => {
      const docs = await Persons.smartQuery({ 'bestFriend.random': 25, $fields: 'name random bestFriend { name random }' })
      expect(docs).toHaveLength(1)
      expect(Object.keys(docs[0]).sort())
        .toEqual(['_id', 'name', 'random', 'bestFriend'].sort())
      expect(docs[0]).toHaveProperty('name', 'Carlos Narvaez')
      expect(docs[0]).toHaveProperty('random', 18)
      expect(docs[0].bestFriend).toHaveProperty('name', 'Michael Yugcha')
      expect(docs[0].bestFriend).toHaveProperty('random', 25)
    })
  })
})
