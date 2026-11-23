import { Client as TypesenseClient } from 'typesense'
import type { ConfigurationOptions } from 'typesense/lib/Typesense/Configuration'

export let globalTypesenseClient: TypesenseClient | null = null

let globalTypesenseConfig: ConfigurationOptions | null = null

const modelClients: Array<{
  clientOptions: Partial<ConfigurationOptions>
  config: ConfigurationOptions
  client: TypesenseClient
}> = []

export function setTypesenseConfig(options: ConfigurationOptions) {
  globalTypesenseConfig = options
  globalTypesenseClient = new TypesenseClient(options)
}

/**
 * Internal helper: returns the global client, or a cached per-model client
 * with `clientOptions` merged over the global configuration.
 */
export function resolveTypesenseClient(
  clientOptions?: Partial<ConfigurationOptions>,
): TypesenseClient | null {
  if (!clientOptions || Object.keys(clientOptions).length === 0) {
    return globalTypesenseClient
  }
  if (!globalTypesenseConfig) return null

  for (const entry of modelClients) {
    if (
      entry.clientOptions === clientOptions &&
      entry.config === globalTypesenseConfig
    ) {
      return entry.client
    }
  }

  const client = new TypesenseClient({
    ...globalTypesenseConfig,
    ...clientOptions,
  })
  modelClients.push({
    clientOptions,
    config: globalTypesenseConfig,
    client,
  })
  return client
}
