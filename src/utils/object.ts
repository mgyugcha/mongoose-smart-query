import type { TObject } from '../types'

export const reemplazarSubdoc = (
  data: TObject,
  path: string,
  reemplazo?: any,
) => {
  if (!reemplazo) return
  let tmp = data
  const campos = path.split('.')
  campos.forEach((campo, index) => {
    if (index === campos.length - 1) {
      if (tmp?.[campo]) tmp[campo] = reemplazo
    } else {
      tmp = tmp?.[campo]
    }
  })
}

export const getCampo = (data: TObject, path: string) => {
  let tmp = data
  const campos = path.split('.')
  campos.forEach((campo) => (tmp = tmp?.[campo]))
  return tmp
}
