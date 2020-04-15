import { getListOfPossibleLookups } from './mongoose-smart-query'

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