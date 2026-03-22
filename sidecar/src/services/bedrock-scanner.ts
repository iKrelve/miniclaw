/**
 * AWS Bedrock Scanner — Auto-detect AWS credentials and scan available models.
 *
 * On sidecar startup, this module:
 * 1. Detects local AWS credentials via the standard credential chain
 * 2. Calls Bedrock ListFoundationModels API to get available models
 * 3. Auto-registers a "AWS Bedrock" provider if credentials are valid
 * 4. Caches the model list for the provider-resolver to use
 */

import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { logger } from '../utils/logger'
import type { CatalogModel } from './provider-resolver'

// ==========================================
// In-memory model cache
// ==========================================

/** Cached Bedrock models — populated by scanBedrockModels(), consumed by provider-resolver.ts */
export let BEDROCK_MODELS: CatalogModel[] = []

/** Detected AWS info — for logging/debugging */
export interface AwsCredentialInfo {
  region: string
  profile?: string
}

// ==========================================
// Credential Detection
// ==========================================

/**
 * Detect AWS credentials using the standard credential provider chain.
 *
 * Priority:
 *   1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
 *   2. AWS_PROFILE / CLAUDE_CODE_AWS_PROFILE env var
 *   3. ~/.aws/credentials [default] profile
 *   4. IMDS (EC2 instance metadata) — if running on EC2
 *
 * Returns null if no valid credentials found.
 */
export async function detectAwsCredentials(): Promise<AwsCredentialInfo | null> {
  try {
    // Determine region from env or default
    const region =
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      process.env.CLAUDE_CODE_AWS_REGION ||
      'us-west-2'

    // Determine profile (if any)
    const profile = process.env.AWS_PROFILE || process.env.CLAUDE_CODE_AWS_PROFILE || undefined

    // Use the standard credential provider chain
    // This will throw if credentials are not found or invalid
    const provider = fromNodeProviderChain({
      timeout: 5000,
      maxRetries: 0,
    })

    // Try to get credentials — this validates they exist
    const creds = await provider()

    if (!creds?.accessKeyId) {
      logger.debug('bedrock', 'No AWS credentials found in provider chain')
      return null
    }

    logger.info('bedrock', 'AWS credentials detected', {
      region,
      profile: profile || 'default',
      accessKeyIdPrefix: creds.accessKeyId.slice(0, 8) + '...',
    })

    return {
      region,
      profile,
    }
  } catch (err) {
    // No credentials available — this is normal, not an error
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Could not load credentials') || msg.includes('Unable to resolve')) {
      logger.debug('bedrock', 'No AWS credentials available', { reason: msg })
    } else {
      logger.warn('bedrock', 'Failed to detect AWS credentials', { error: msg })
    }
    return null
  }
}

// ==========================================
// Model Scanning
// ==========================================

/**
 * Scan Bedrock foundation models for the given region.
 *
 * Filters to Anthropic Claude models only (Claude Code SDK only supports Claude via Bedrock).
 * Returns a list of CatalogModel suitable for the provider-resolver.
 */
export async function scanBedrockModels(region: string): Promise<CatalogModel[]> {
  try {
    const client = new BedrockClient({ region })

    const command = new ListFoundationModelsCommand({})
    const response = await client.send(command)

    if (!response.modelSummaries || response.modelSummaries.length === 0) {
      logger.warn('bedrock', 'No foundation models returned from Bedrock', { region })
      return []
    }

    // Filter to Anthropic Claude models only
    const claudeModels = response.modelSummaries.filter(
      (m) => m.providerName === 'Anthropic' && m.modelId?.includes('claude'),
    )

    const models: CatalogModel[] = claudeModels.map((m) => ({
      id: m.modelId as string,
      // Extract display name from model name (e.g. "Claude 3.5 Sonnet")
      name: m.modelName || (m.modelId as string).split('.').pop() || (m.modelId as string),
      contextWindow: 200000, // Bedrock Claude models typically have 200k context
      provider: 'bedrock',
    }))

    logger.info('bedrock', 'Scanned Bedrock models', {
      region,
      total: response.modelSummaries.length,
      claude: models.length,
      modelIds: models.map((m) => m.id).slice(0, 5),
    })

    return models
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('bedrock', 'Failed to scan Bedrock models', { region, error: msg })
    return []
  }
}

// ==========================================
// Auto-Registration
// ==========================================

/**
 * Auto-register Bedrock provider if AWS credentials are available.
 *
 * Called from sidecar startup (index.ts).
 * Does NOT throw on failure — just logs and returns.
 */
export async function autoRegisterBedrock(): Promise<void> {
  try {
    // Check for credentials
    const credInfo = await detectAwsCredentials()
    if (!credInfo) {
      logger.info('bedrock', 'Skipping Bedrock auto-registration — no AWS credentials')
      return
    }

    // Scan available models
    const models = await scanBedrockModels(credInfo.region)
    if (models.length === 0) {
      logger.warn('bedrock', 'No Claude models found in Bedrock — skipping auto-registration')
      return
    }

    // Cache models for provider-resolver
    BEDROCK_MODELS = models

    // Build extra_env by scanning all Bedrock-related env vars from the current environment.
    // Only include a key if it actually exists — no hardcoded values.
    const extraEnv: Record<string, string> = {
      // Always required — tells Claude Code SDK to use Bedrock
      CLAUDE_CODE_USE_BEDROCK: '1',
      // Region is always known (from detection or default)
      AWS_REGION: credInfo.region,
    }

    // All Bedrock-relevant env vars to scan — if present, include them
    const ENV_KEYS_TO_SCAN = [
      // AWS auth & profile
      'CLAUDE_CODE_AWS_PROFILE',
      'AWS_PROFILE',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'AWS_DEFAULT_REGION',
      // Claude Code SDK Bedrock-specific flags
      'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
      'CLAUDE_CODE_AWS_REGION',
      'ANTHROPIC_MODEL',
      // Proxy settings
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'no_proxy',
    ]

    for (const key of ENV_KEYS_TO_SCAN) {
      const value = process.env[key]
      if (value) {
        extraEnv[key] = value
      }
    }

    // Register provider in DB
    const { upsertProvider, activateProvider } = await import('../db')
    const id = upsertProvider({
      name: 'AWS Bedrock',
      type: 'bedrock',
      api_key: '', // Bedrock uses AWS credentials, not API key
      base_url: '',
      extra_env: JSON.stringify(extraEnv),
    })

    // Activate if no other provider is active
    activateProvider(id)

    logger.info('bedrock', 'Auto-registered AWS Bedrock provider', {
      id,
      region: credInfo.region,
      profile: credInfo.profile,
      modelCount: models.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('bedrock', 'Failed to auto-register Bedrock provider', { error: msg })
  }
}

/**
 * Refresh Bedrock model cache.
 *
 * Can be called periodically or on-demand to update the model list.
 */
export async function refreshBedrockModels(): Promise<CatalogModel[]> {
  try {
    const credInfo = await detectAwsCredentials()
    if (!credInfo) {
      logger.debug('bedrock', 'Cannot refresh models — no AWS credentials')
      return BEDROCK_MODELS
    }

    const models = await scanBedrockModels(credInfo.region)
    if (models.length > 0) {
      BEDROCK_MODELS = models
      logger.info('bedrock', 'Refreshed Bedrock model cache', { count: models.length })
    }

    return BEDROCK_MODELS
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn('bedrock', 'Failed to refresh Bedrock models', { error: msg })
    return BEDROCK_MODELS
  }
}
