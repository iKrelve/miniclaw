/**
 * Provider HTTP routes — CRUD for API providers + model catalog
 */

import { Hono } from 'hono'
import {
  createProvider,
  getProvider,
  listProviders,
  updateProvider,
  deleteProvider,
  activateProvider,
  getSetting,
} from '../db'
import { getModelsForProvider } from '../services/provider-resolver'
import { getCachedModels } from '../services/sdk-capabilities'
import type { ProviderModelGroup } from '../../../shared/types'

const providerRoutes = new Hono()

/** GET /providers — List all providers */
providerRoutes.get('/', (c) => {
  return c.json({ providers: listProviders() })
})

/** POST /providers — Create a new provider */
providerRoutes.post('/', async (c) => {
  const body = await c.req.json()
  const { name, type, api_key, base_url, extra_env } = body
  if (!name || !type) {
    return c.json({ error: 'name and type are required' }, 400)
  }
  const provider = createProvider({
    name,
    type,
    api_key: api_key || '',
    base_url,
    extra_env,
  })
  return c.json({ provider }, 201)
})

/**
 * GET /providers/models — Return provider model groups for the model selector.
 *
 * Response: { groups: ProviderModelGroup[], default_provider_id: string }
 *
 * NOTE: This route MUST be defined BEFORE `/:id` so Hono doesn't match
 * "models" as a provider ID.
 */
providerRoutes.get('/models', (c) => {
  const groups: ProviderModelGroup[] = []
  const providers = listProviders()

  // Check if any DB provider is an auto-registered proxy (MCopilot etc.)
  // If so, skip the env group to avoid showing duplicate model lists.
  const hasProxy = providers.some(
    (p) => (p.name as string) === 'MCopilot' || !!(p.base_url as string),
  )

  // 1) Built-in "env" group — only shown when no proxy provider is registered.
  //    After the first chat, SDK-discovered models replace the static defaults.
  if (!hasProxy) {
    const defaultModels = [
      { value: 'sonnet', label: 'Sonnet 4.6' },
      { value: 'opus', label: 'Opus 4.6' },
      { value: 'haiku', label: 'Haiku 4.5' },
    ]
    const sdkModels = getCachedModels('env')
    const envModels =
      sdkModels.length > 0
        ? sdkModels.map((m) => ({ value: m.value, label: m.displayName }))
        : defaultModels

    groups.push({
      provider_id: 'env',
      provider_name: 'Claude Code',
      provider_type: 'anthropic',
      models: envModels,
    })
  }

  // 2) Build a group for each user-configured provider (including auto-registered MCopilot)
  for (const provider of providers) {
    const pid = provider.id as string
    const type = (provider.type as string) || 'anthropic'

    // Prefer SDK-discovered models (cached after first chat with this provider)
    const cached = getCachedModels(pid)
    let models: { value: string; label: string }[]

    if (cached.length > 0) {
      models = cached.map((m) => ({ value: m.value, label: m.displayName }))
    } else {
      // Also try 'env' cache — mc proxy uses env path under the hood
      const envCached = getCachedModels('env')
      if (envCached.length > 0) {
        models = envCached.map((m) => ({ value: m.value, label: m.displayName }))
      } else {
        // Fall back to static catalog
        const catalog = getModelsForProvider(type)
        models = catalog.map((m) => ({ value: m.id, label: m.name }))
        if (models.length === 0) {
          models.push({ value: 'default', label: type })
        }
      }
    }

    groups.push({
      provider_id: pid,
      provider_name: (provider.name as string) || type,
      provider_type: type,
      models,
    })
  }

  // Determine default provider
  const defaultId =
    getSetting('default_provider_id') ||
    (providers.find((p) => p.is_active)?.id as string) ||
    (groups[0]?.provider_id ?? 'env')

  return c.json({ groups, default_provider_id: defaultId })
})

/** GET /providers/:id — Get a provider */
providerRoutes.get('/:id', (c) => {
  const id = c.req.param('id')
  const provider = getProvider(id)
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404)
  }
  return c.json({ provider })
})

/** PUT /providers/:id — Update a provider */
providerRoutes.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const provider = getProvider(id)
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404)
  }
  updateProvider(id, body)
  return c.json({ provider: getProvider(id) })
})

/** DELETE /providers/:id — Delete a provider */
providerRoutes.delete('/:id', (c) => {
  const id = c.req.param('id')
  const provider = getProvider(id)
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404)
  }
  deleteProvider(id)
  return c.json({ success: true })
})

/** POST /providers/:id/activate — Set as default provider */
providerRoutes.post('/:id/activate', (c) => {
  const id = c.req.param('id')
  const provider = getProvider(id)
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404)
  }
  activateProvider(id)
  return c.json({ success: true })
})

export default providerRoutes
