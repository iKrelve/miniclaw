/**
 * SDK Capabilities Cache — captures and caches model info from active
 * Claude Code SDK Query instances.
 *
 * After each query() call, captureModels() is called fire-and-forget
 * to populate the cache. The /providers/models route reads from this
 * cache to return real model lists instead of static defaults.
 */

import type { ModelInfo, Query } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '../utils/logger'

// In-memory cache keyed by providerId
const modelCache = new Map<string, ModelInfo[]>()

/**
 * Check if a conversation object is a real Query instance with
 * supportedModels(). Resume-fallback generators lack these methods.
 */
function isQuery(conversation: unknown): conversation is Query {
  return conversation != null && typeof (conversation as Query).supportedModels === 'function'
}

/**
 * Capture supported models from an active Query instance and cache them.
 * Fire-and-forget — safe to call with non-Query objects (silently skips).
 */
export async function captureModels(
  conversation: unknown,
  providerId: string = 'env',
): Promise<void> {
  if (!isQuery(conversation)) return

  try {
    const models = await conversation.supportedModels()
    if (models.length > 0) {
      modelCache.set(providerId, models)
      logger.info('sdk-capabilities', 'Captured models', {
        providerId,
        count: models.length,
        names: models.map((m) => m.value).join(', '),
      })
    }
  } catch (err) {
    logger.warn('sdk-capabilities', 'Failed to capture models', {
      providerId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Get cached models for a provider. Returns empty array if not yet captured. */
export function getCachedModels(providerId: string = 'env'): ModelInfo[] {
  return modelCache.get(providerId) || []
}
