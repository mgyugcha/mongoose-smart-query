import { Schema } from 'mongoose'
import type { TObject, LookupConfirmado } from '../types'
import { reemplazarSubdoc } from './object'

/**
 * Gets a list of possible fields that could allow a $lookup. This list is
 * obtained from the nested fields of the object.
 * @param schema The mongoose schema to resolve paths
 * @param $project The $project's pipeline that can contains possible $lookup.
 * @param padre Parent path context
 * @returns An array with the fields with a possible $lookup.
 */
export const getListOfPossibleLookups = (
  schema: Schema,
  $project: TObject = {},
  padre = '',
): LookupConfirmado[] => {
  padre &&= padre + '.'
  const confirmados: LookupConfirmado[] = []

  const addCampos = (field: string, from: string, project: TObject) => {
    const existente = confirmados.find((item) => item.field === field)
    if (existente) {
      existente.project = { ...existente.project, ...project }
    } else {
      confirmados.push({ field, from, project })
    }
  }

  for (const key in $project) {
    if (typeof $project[key] === 'object') {
      const path = schema.path(padre + key)
      if (path && path.options.ref) {
        addCampos(padre + key, path.options.ref, $project[key])
      } else {
        const subkeys = getListOfPossibleLookups(
          schema,
          $project[key],
          padre + key,
        )
        subkeys.forEach((result) => {
          addCampos(result.field, result.from, result.project)
        })
      }
    } else if (key.includes('.') || padre) {
      const splited = key.split(/\.(.+)/)
      const path = schema.path(padre + splited[0])
      if (path && path.options.ref) {
        const existente = confirmados.find((item) => item.field === splited[0])
        if (existente) {
          existente.project[splited[1]] = 1
        } else {
          confirmados.push({
            field: splited[0],
            from: path.options.ref,
            project: { [splited[1]]: 1 },
          })
        }
      }
      continue
    } else {
      continue
    }
  }
  return confirmados
}

export const asignarLookups = (
  lookup: TObject = {},
  confirmados: LookupConfirmado[],
) => {
  for (const confirmado of confirmados) {
    if (confirmado.field.includes('.') || lookup[confirmado.field]) {
      reemplazarSubdoc(lookup, confirmado.field, 1)
    } else {
      for (const key in lookup) {
        if (key.startsWith(confirmado.field + '.')) {
          delete lookup[key]
          lookup[confirmado.field] = 1
        }
      }
    }
  }
}
