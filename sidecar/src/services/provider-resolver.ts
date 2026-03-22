/**
 * Provider Resolver — unified provider + model resolution.
 *
 * Priority chain: request → session → default → env
 * Includes built-in model catalog for each provider type.
 */

import { getProvider, listProviders, getSetting } from '../db'
import { BEDROCK_MODELS } from './bedrock-scanner'

// ==========================================
// Model Catalog
// ==========================================

export interface CatalogModel {
  id: string
  name: string
  contextWindow: number
  provider: string
}

const MODEL_CATALOG: Record<string, CatalogModel[]> = {
  anthropic: [
    // SDK shorthand names — used by Claude Code SDK and compatible proxies
    { id: 'sonnet', name: 'Sonnet 4.6', contextWindow: 200000, provider: 'anthropic' },
    { id: 'opus', name: 'Opus 4.6', contextWindow: 200000, provider: 'anthropic' },
    { id: 'haiku', name: 'Haiku 4.5', contextWindow: 200000, provider: 'anthropic' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, provider: 'openai' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, provider: 'openai' },
    { id: 'o3-mini', name: 'O3 Mini', contextWindow: 200000, provider: 'openai' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, provider: 'openai' },
  ],
  google: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, provider: 'google' },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      contextWindow: 1000000,
      provider: 'google',
    },
    {
      id: 'gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      contextWindow: 1000000,
      provider: 'google',
    },
  ],
  // Bedrock models are dynamically populated by bedrock-scanner.ts
  // See BEDROCK_MODELS cache populated at startup
  bedrock: [],
  vertex: [
    {
      id: 'claude-sonnet-4@20250514',
      name: 'Claude Sonnet 4 (Vertex)',
      contextWindow: 200000,
      provider: 'vertex',
    },
  ],
  // Custom provider — empty by default, user types model name directly
  custom: [],
}

export function getModelsForProvider(providerType: string): CatalogModel[] {
  // For bedrock, return dynamic models from AWS API scan
  if (providerType === 'bedrock') {
    return BEDROCK_MODELS.length > 0 ? BEDROCK_MODELS : MODEL_CATALOG['bedrock']
  }
  return MODEL_CATALOG[providerType] || []
}

export function getAllModels(): CatalogModel[] {
  return Object.values(MODEL_CATALOG).flat()
}

// ==========================================
// Resolution
// ==========================================

export interface ResolveOptions {
  providerId?: string
  sessionProviderId?: string
  model?: string
  sessionModel?: string
}

export interface ResolvedProvider {
  provider: Record<string, unknown> | undefined
  model: string | undefined
  models: CatalogModel[]
  hasCredentials: boolean
}

/**
 * Resolve provider + model using priority chain.
 */
export function resolveProvider(opts: ResolveOptions = {}): ResolvedProvider {
  const effectiveProviderId = opts.providerId || opts.sessionProviderId || ''

  let provider: Record<string, unknown> | undefined

  if (effectiveProviderId && effectiveProviderId !== 'env') {
    provider = getProvider(effectiveProviderId) as Record<string, unknown> | undefined
    if (!provider) {
      // Fallback to first active provider
      const providers = listProviders()
      provider = (providers.find((p) => p.is_active) || providers[0]) as
        | Record<string, unknown>
        | undefined
    }
  } else if (!effectiveProviderId) {
    // Use global default or first active
    const defaultId = getSetting('default_provider_id')
    if (defaultId) {
      provider = getProvider(defaultId) as Record<string, unknown> | undefined
    }
    if (!provider) {
      const providers = listProviders()
      provider = (providers.find((p) => p.is_active) || providers[0]) as
        | Record<string, unknown>
        | undefined
    }
  }

  const providerType = (provider?.type as string) || 'anthropic'
  const models = getModelsForProvider(providerType)
  const effectiveModel =
    opts.model ||
    opts.sessionModel ||
    getSetting('default_model') ||
    getSetting('anthropic_model') ||
    models[0]?.id

  // Check credentials: provider api_key OR global proxy auth token
  const hasCredentials = !!provider?.api_key || !!getSetting('anthropic_auth_token')

  return {
    provider,
    model: effectiveModel,
    models,
    hasCredentials,
  }
}
