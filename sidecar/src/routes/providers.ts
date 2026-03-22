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
import type { ProviderModelGroup } from '../../../shared/types'

const providerRoutes = new Hono()

/** GET /providers — List all providers */
providerRoutes.get('/', (c) => {
  return c.json({ providers: listProviders() })
})

/** POST /providers — Create a new provider */
providerRoutes.post('/', async (c) => {
  const body = await c.req.json()
  const { name, type, api_key, base_url } = body
  if (!name || !type) {
    return c.json({ error: 'name and type are required' }, 400)
  }
  const provider = createProvider({ name, type, api_key: api_key || '', base_url })
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

  // 1) Built-in "env" group — always present (Claude Code SDK default path)
  groups.push({
    provider_id: 'env',
    provider_name: 'Claude Code',
    provider_type: 'anthropic',
    models: [
      { value: 'sonnet', label: 'Claude Sonnet 4' },
      { value: 'opus', label: 'Claude Opus 4' },
      { value: 'haiku', label: 'Claude Haiku 3.5' },
    ],
  })

  // 2) Build a group for each user-configured provider
  const providers = listProviders()
  for (const provider of providers) {
    const type = (provider.type as string) || 'anthropic'
    const catalog = getModelsForProvider(type)
    const models = catalog.map((m) => ({
      value: m.id,
      label: m.name,
    }))

    // If the catalog is empty for this provider type (e.g. custom),
    // add a placeholder so the group still appears
    if (models.length === 0) {
      models.push({ value: 'default', label: type })
    }

    groups.push({
      provider_id: provider.id as string,
      provider_name: (provider.name as string) || type,
      provider_type: type,
      models,
    })
  }

  // Determine default provider
  const defaultId =
    getSetting('default_provider_id') || (providers.find((p) => p.is_active)?.id as string) || 'env'

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
