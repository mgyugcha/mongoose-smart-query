import { Client as TypesenseClient } from 'typesense'
import type { ConfigurationOptions } from 'typesense/lib/Typesense/Configuration'

export let globalTypesenseClient: TypesenseClient | null = null

export function setTypesenseConfig(options: ConfigurationOptions) {
  globalTypesenseClient = new TypesenseClient(options)
}
