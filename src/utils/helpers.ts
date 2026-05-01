import { Types } from 'mongoose'
import type { TObject } from '../types'

/**
 * Normalizes text for search indexing and querying.
 * Converts to lowercase, removes diacritics/accents, and removes any non-alphanumeric character (except the spacer).
 * Multiple spaces/spacers are collapsed into one.
 * @param input String or array of strings to concatenate and normalize.
 * @param spacer String used to join array values or replace spaces. Default is ' '.
 * @returns The normalized string.
 */
export function normalizeSearchText(
  input: string | Array<string | undefined>,
  spacer = ' ',
  maxSearchLength = 900,
): string {
  if (!input) return ''

  const processStr = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD') // Decompose combined graphemes into the combination of simple ones
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9 ]/g, '') // Remove symbols down to alphanumeric and spaces
      .trim()
      .replace(/\s+/g, spacer) // Collapse multiple spaces and apply spacer

  if (Array.isArray(input)) {
    return input
      .map((item) => (item ? processStr(item) : ''))
      .filter(Boolean)
      .join(spacer)
  }
  return processStr(input).substring(0, maxSearchLength)
}

/**
 * Converts a string to object. Example:
 * 'name age friends { name }' => { name: 1, age: 1, friends: { name: 1 } }
 * @param query String to convert to object.
 * @returns The resulting object.
 */
export function stringToQuery(query: string = '', value = '1'): object {
  const regex = /(})(?!$| *})|([\w.]+)(?= *\{)|([\w.]+)(?=$| *})|([\w.]+)/g
  const preJSON = query.replace(regex, (match, p1, p2, p3, p4) => {
    if (p1) {
      return p1 + ','
    } else if (p2) {
      return `"${p2}":`
    } else if (p3) {
      return `"${p3}": ${value}`
    } else if (p4) {
      return `"${p4}": ${value},`
    } else {
      return ''
    }
  })
  return JSON.parse(`{ ${preJSON} }`)
}

export const parseValue = (value: string, instance?: string) => {
  switch (instance) {
    case 'ObjectID':
    case 'ObjectId':
      return new Types.ObjectId(value)
    case 'Date':
      return new Date(value)
    case 'Number':
      return Number(value)
    case 'Boolean':
      return typeof value === 'boolean' ? value : value === 'true'
    default:
      return value
  }
}

/**
 * Remove the keys from the initial object. If after this process the property
 * is empty it is removed
 * @param initial The main object
 * @param toRemove The object with the keys to remove
 * @returns The object without the keys
 */
export function removeKeys(initial: TObject, toRemove: TObject): TObject {
  const principal = { ...initial }
  for (const key in toRemove) {
    if (!principal[key]) continue
    if (typeof toRemove[key] === 'object') {
      principal[key] = removeKeys(principal[key], toRemove[key])
      if (Object.keys(principal[key]).length === 0) delete principal[key]
    } else {
      delete principal[key]
    }
  }
  return principal
}
