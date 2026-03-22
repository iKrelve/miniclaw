/**
 * 小龙虾 (MiniClaw) — Claude Client Service
 *
 * Wraps @anthropic-ai/claude-agent-sdk to produce SSE event streams.
 * Simplified from CodePilot's src/lib/claude-client.ts — no Telegram,
 * no image-agent, no Bridge. Pure AI conversation streaming.
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKPartialAssistantMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
  Options,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpServerConfig as SdkMcpServerConfig,
} from '@anthropic-ai/claude-agent-sdk'
// SDK-embedded CLI: in dev mode returns the node_modules path directly;
// in `bun build --compile` extracts from $bunfs to a temp directory.
import embeddedCliPath from '@anthropic-ai/claude-agent-sdk/embed'
import type { McpServerConfig, TokenUsage, PermissionRequestEvent } from '../../../shared/types'
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { getSetting, getProvider, updateSdkSessionId } from '../db'
import { findClaudeBinary, getExpandedPath } from './platform'
import { captureModels } from './sdk-capabilities'
import { getBrowserMcpServer } from './browser-tool'
import { chromeManager } from './chrome-manager'
import { logger } from '../utils/logger'
import os from 'os'

// ==========================================
// Active conversations registry (for interrupt)
// ==========================================

const activeConversations = new Map<string, { abort: AbortController }>()

export function interruptSession(sessionId: string): boolean {
  const entry = activeConversations.get(sessionId)
  if (entry) {
    entry.abort.abort()
    activeConversations.delete(sessionId)
    return true
  }
  return false
}

// ==========================================
// SSE Formatting
// ==========================================

interface SSEEvent {
  type: string
  data: unknown
}

function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

// ==========================================
// MCP Config Conversion
// ==========================================

function toSdkMcpConfig(
  servers: Record<string, McpServerConfig>,
): Record<string, SdkMcpServerConfig> {
  const result: Record<string, SdkMcpServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    const transport = config.type || 'stdio'
    switch (transport) {
      case 'sse': {
        if (!config.url) continue
        const sseConfig: McpSSEServerConfig = { type: 'sse', url: config.url }
        if (config.headers && Object.keys(config.headers).length > 0) {
          sseConfig.headers = config.headers
        }
        result[name] = sseConfig
        break
      }
      case 'http': {
        if (!config.url) continue
        const httpConfig: McpHttpServerConfig = { type: 'http', url: config.url }
        if (config.headers && Object.keys(config.headers).length > 0) {
          httpConfig.headers = config.headers
        }
        result[name] = httpConfig
        break
      }
      case 'stdio':
      default: {
        if (!config.command) continue
        const stdioConfig: McpStdioServerConfig = {
          command: config.command,
          args: config.args,
          env: config.env,
        }
        result[name] = stdioConfig
        break
      }
    }
  }
  return result
}

// ==========================================
// Token Usage Extraction
// ==========================================

function extractTokenUsage(msg: SDKResultMessage): TokenUsage | null {
  if (!msg.usage) return null
  return {
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
  }
}

// ==========================================
// Env Sanitization
// ==========================================

function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      clean[key] = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    }
  }
  return clean
}

// ==========================================
// Stream Options
// ==========================================

export interface StreamChatOptions {
  prompt: string
  sessionId: string
  sdkSessionId?: string
  model?: string
  systemPrompt?: string
  workingDirectory: string
  mcpServers?: Record<string, McpServerConfig>
  mode?: 'code' | 'plan' | 'ask'
  permissionMode?: string
  permissionProfile?: 'default' | 'full_access'
  providerId?: string
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}

// ==========================================
// Pending Permissions
// ==========================================

interface PendingPermission {
  resolve: (result: PermissionResult) => void
}

const pendingPermissions = new Map<string, PendingPermission>()

export function resolvePermission(permissionId: string, allow: boolean, updatedInput?: unknown) {
  const pending = pendingPermissions.get(permissionId)
  if (!pending) return
  if (allow) {
    pending.resolve({
      behavior: 'allow',
      updatedInput: updatedInput as Record<string, unknown> | undefined,
    })
  } else {
    pending.resolve({ behavior: 'deny', message: 'User denied permission' })
  }
  pendingPermissions.delete(permissionId)
}

// ==========================================
// Main Stream Function
// ==========================================

/**
 * Stream Claude responses. Returns a ReadableStream of SSE-formatted strings.
 */
export function streamChat(options: StreamChatOptions): ReadableStream<string> {
  const {
    prompt,
    sessionId,
    sdkSessionId,
    model,
    systemPrompt,
    workingDirectory,
    mcpServers,
    permissionMode,
    permissionProfile,
    providerId,
  } = options

  return new ReadableStream<string>({
    async start(controller) {
      const abortController = new AbortController()
      activeConversations.set(sessionId, { abort: abortController })

      // Expand ~ to home directory (Node/Bun child_process doesn't do shell expansion)
      const resolvedCwd = workingDirectory.startsWith('~')
        ? workingDirectory.replace(/^~/, os.homedir())
        : workingDirectory

      logger.info('claude', 'streamChat.start', {
        sessionId,
        prompt: prompt.slice(0, 100),
        model,
        hasSystemPrompt: !!systemPrompt,
        workingDirectory,
        resolvedCwd,
      })

      try {
        // Build environment
        const sdkEnv: Record<string, string> = { ...(process.env as Record<string, string>) }
        if (!sdkEnv.HOME) sdkEnv.HOME = os.homedir()
        if (!sdkEnv.USERPROFILE) sdkEnv.USERPROFILE = os.homedir()
        sdkEnv.PATH = getExpandedPath()
        delete sdkEnv.CLAUDECODE

        // Inject API proxy env vars from provider config or global settings.
        // Priority: provider base_url/api_key > settings > process.env (already in sdkEnv)
        if (providerId) {
          const provider = getProvider(providerId) as Record<string, unknown> | undefined
          if (provider?.base_url) sdkEnv.ANTHROPIC_BASE_URL = provider.base_url as string
          if (provider?.api_key) sdkEnv.ANTHROPIC_AUTH_TOKEN = provider.api_key as string
          // Inject extra_env for Bedrock/Vertex providers
          if (provider?.extra_env && typeof provider.extra_env === 'string') {
            try {
              const extraEnv = JSON.parse(provider.extra_env) as Record<string, string>
              for (const [key, value] of Object.entries(extraEnv)) {
                // Don't override existing env vars (priority chain)
                if (!sdkEnv[key]) {
                  sdkEnv[key] = value
                }
              }
              logger.debug('claude', 'Injected extra_env from provider', {
                sessionId,
                providerId,
                keys: Object.keys(extraEnv),
              })
            } catch (e) {
              logger.warn('claude', 'Failed to parse provider extra_env', {
                sessionId,
                providerId,
                error: e instanceof Error ? e.message : String(e),
              })
            }
          }
        }
        // Global settings fallback (user-configured via Settings UI)
        const settingsBaseUrl = getSetting('anthropic_base_url')
        const settingsAuthToken = getSetting('anthropic_auth_token')
        const settingsCustomHeaders = getSetting('anthropic_custom_headers')
        const settingsModel = getSetting('anthropic_model')
        if (settingsBaseUrl && !sdkEnv.ANTHROPIC_BASE_URL)
          sdkEnv.ANTHROPIC_BASE_URL = settingsBaseUrl
        if (settingsAuthToken && !sdkEnv.ANTHROPIC_AUTH_TOKEN)
          sdkEnv.ANTHROPIC_AUTH_TOKEN = settingsAuthToken
        if (settingsCustomHeaders && !sdkEnv.ANTHROPIC_CUSTOM_HEADERS)
          sdkEnv.ANTHROPIC_CUSTOM_HEADERS = settingsCustomHeaders
        if (settingsModel && !model && !sdkEnv.ANTHROPIC_MODEL)
          sdkEnv.ANTHROPIC_MODEL = settingsModel

        // Override X-Working-Dir in custom headers with actual resolved cwd
        // (the proxy refresher may have captured a stale temp dir path)
        if (sdkEnv.ANTHROPIC_CUSTOM_HEADERS || sdkEnv.ANTHROPIC_BASE_URL) {
          const effectiveCwd = resolvedCwd || os.homedir()
          // Encode non-ASCII chars — HTTP headers reject raw multibyte (e.g. Chinese path segments)
          const safeCwd = effectiveCwd.replace(/[^\x20-\x7E]/g, (ch) => encodeURIComponent(ch))
          const existing = sdkEnv.ANTHROPIC_CUSTOM_HEADERS || ''
          // Replace existing X-Working-Dir or append if not present
          if (existing.includes('X-Working-Dir:')) {
            sdkEnv.ANTHROPIC_CUSTOM_HEADERS = existing.replace(
              /X-Working-Dir:\s*[^\n,;]*/,
              `X-Working-Dir: ${safeCwd}`,
            )
          } else if (existing.includes('X-Branch:')) {
            // X-Branch is also a proxy header — replace with X-Working-Dir
            sdkEnv.ANTHROPIC_CUSTOM_HEADERS = existing.replace(
              /X-Branch:\s*[^\n,;]*/,
              `X-Working-Dir: ${safeCwd}`,
            )
          } else if (existing) {
            sdkEnv.ANTHROPIC_CUSTOM_HEADERS = `${existing}, X-Working-Dir: ${safeCwd}`
          } else {
            sdkEnv.ANTHROPIC_CUSTOM_HEADERS = `X-Working-Dir: ${safeCwd}`
          }
        }

        // Log resolved env vars (mask sensitive values)
        logger.info('claude', 'SDK environment resolved', {
          sessionId,
          hasBaseUrl: !!sdkEnv.ANTHROPIC_BASE_URL,
          baseUrl: sdkEnv.ANTHROPIC_BASE_URL || '(not set)',
          hasAuthToken: !!sdkEnv.ANTHROPIC_AUTH_TOKEN,
          authTokenPrefix: sdkEnv.ANTHROPIC_AUTH_TOKEN
            ? sdkEnv.ANTHROPIC_AUTH_TOKEN.slice(0, 8) + '...'
            : '(not set)',
          hasCustomHeaders: !!sdkEnv.ANTHROPIC_CUSTOM_HEADERS,
          customHeaders: sdkEnv.ANTHROPIC_CUSTOM_HEADERS || '(not set)',
          hasModel: !!sdkEnv.ANTHROPIC_MODEL,
        })

        // Check if bypass permissions (global setting or session-level full_access)
        const globalSkip = getSetting('dangerously_skip_permissions') === 'true'
        const sessionBypass = permissionProfile === 'full_access'

        const queryOptions: Options = {
          cwd: resolvedCwd || os.homedir(),
          abortController,
          includePartialMessages: true,
          permissionMode:
            globalSkip || sessionBypass
              ? 'bypassPermissions'
              : (permissionMode as Options['permissionMode']) || 'acceptEdits',
          env: sanitizeEnv(sdkEnv),
        }

        if (globalSkip || sessionBypass) {
          queryOptions.allowDangerouslySkipPermissions = true
        }

        // Find claude binary: prefer system-installed claude, fall back to SDK-embedded CLI
        const claudePath = findClaudeBinary()
        const effectiveCliPath = claudePath || embeddedCliPath
        logger.info('claude', 'Claude binary resolution', {
          sessionId,
          claudePath: claudePath || '(not found)',
          embeddedCliPath,
          effectiveCliPath,
        })
        queryOptions.pathToClaudeCodeExecutable = effectiveCliPath

        if (model) queryOptions.model = model

        if (systemPrompt) {
          queryOptions.systemPrompt = {
            type: 'preset',
            preset: 'claude_code',
            append: systemPrompt,
          }
        }

        // MCP servers
        if (mcpServers && Object.keys(mcpServers).length > 0) {
          queryOptions.mcpServers = toSdkMcpConfig(mcpServers)
        }

        // Inject browser MCP server when Chrome is running
        if (chromeManager.isRunning()) {
          const browserServer = getBrowserMcpServer()
          if (browserServer) {
            queryOptions.mcpServers = {
              ...(queryOptions.mcpServers || {}),
              'miniclaw-browser': browserServer,
            }
            logger.info('claude', 'Injected browser MCP server', { sessionId })
          }
        }

        // Resume session
        if (sdkSessionId) {
          queryOptions.resume = sdkSessionId
        }

        // Permission handler
        queryOptions.canUseTool = async (toolName, input, opts) => {
          // Auto-approve when session has full_access profile
          if (sessionBypass) {
            return { behavior: 'allow' } as PermissionResult
          }

          const permId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

          const permEvent: PermissionRequestEvent = {
            id: permId,
            tool_name: toolName,
            description: ((opts as Record<string, unknown>).decisionReason as string) || '',
            input,
          }

          controller.enqueue(
            formatSSE({
              type: 'permission_request',
              data: JSON.stringify(permEvent),
            }),
          )

          // Wait for user response
          return new Promise<PermissionResult>((resolve) => {
            pendingPermissions.set(permId, { resolve })
            // Auto-timeout after 5 minutes
            setTimeout(
              () => {
                if (pendingPermissions.has(permId)) {
                  pendingPermissions.delete(permId)
                  resolve({ behavior: 'deny', message: 'Permission request timed out' })
                }
              },
              5 * 60 * 1000,
            )
          })
        }

        // Capture stderr
        queryOptions.stderr = (data: string) => {
          const cleaned = data
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim()
          if (cleaned) {
            controller.enqueue(formatSSE({ type: 'tool_output', data: cleaned }))
          }
        }

        // Start conversation
        logger.info('claude', 'Calling SDK query()', {
          sessionId,
          model: queryOptions.model || '(default)',
          cwd: queryOptions.cwd,
          permissionMode: queryOptions.permissionMode,
          hasResume: !!queryOptions.resume,
          mcpServerCount: queryOptions.mcpServers ? Object.keys(queryOptions.mcpServers).length : 0,
        })

        const conversation = query({ prompt, options: queryOptions })

        // Fire-and-forget: capture SDK-reported models for the model selector.
        // Uses providerId so different providers get separate caches.
        const capProviderId = providerId || 'env'
        captureModels(conversation, capProviderId).catch(() => {})

        let tokenUsage: TokenUsage | null = null
        let messageCount = 0

        for await (const message of conversation) {
          messageCount++
          if (abortController.signal.aborted) break

          // Log first few messages and then periodically
          if (messageCount <= 5 || messageCount % 20 === 0) {
            logger.debug('claude', 'SDK message received', {
              sessionId,
              type: message.type,
              messageCount,
            })
          }

          switch (message.type) {
            case 'assistant': {
              const assistantMsg = message as SDKAssistantMessage
              for (const block of assistantMsg.message.content) {
                if (block.type === 'tool_use') {
                  controller.enqueue(
                    formatSSE({
                      type: 'tool_use',
                      data: JSON.stringify({
                        id: block.id,
                        name: block.name,
                        input: block.input,
                      }),
                    }),
                  )
                }
              }
              break
            }

            case 'user': {
              const userMsg = message as SDKUserMessage
              const content = userMsg.message.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    const resultContent =
                      typeof block.content === 'string'
                        ? block.content
                        : Array.isArray(block.content)
                          ? block.content
                              .filter((c: Record<string, unknown>) => c.type === 'text')
                              .map((c: Record<string, unknown>) => c.text)
                              .join('\n')
                          : String(block.content ?? '')
                    controller.enqueue(
                      formatSSE({
                        type: 'tool_result',
                        data: JSON.stringify({
                          tool_use_id: block.tool_use_id,
                          content: resultContent,
                          is_error: block.is_error || false,
                        }),
                      }),
                    )
                  }
                }
              }
              break
            }

            case 'stream_event': {
              const streamEvent = message as SDKPartialAssistantMessage
              const evt = streamEvent.event
              if (evt.type === 'content_block_delta' && 'delta' in evt) {
                const delta = evt.delta as Record<string, unknown>
                if ('text' in delta && delta.text) {
                  controller.enqueue(formatSSE({ type: 'text', data: delta.text }))
                }
              }
              break
            }

            case 'system': {
              const sysMsg = message as SDKSystemMessage
              if ('subtype' in sysMsg && sysMsg.subtype === 'init') {
                controller.enqueue(
                  formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      session_id: sysMsg.session_id,
                      model: sysMsg.model,
                      tools: sysMsg.tools,
                    }),
                  }),
                )
                // Save SDK session ID for resume
                if (sysMsg.session_id && sessionId) {
                  try {
                    updateSdkSessionId(sessionId, sysMsg.session_id)
                  } catch {
                    /* best effort */
                  }
                }
              }
              break
            }

            case 'tool_progress': {
              const progressMsg = message as SDKToolProgressMessage
              controller.enqueue(
                formatSSE({
                  type: 'tool_output',
                  data: JSON.stringify({
                    _progress: true,
                    tool_use_id: progressMsg.tool_use_id,
                    tool_name: progressMsg.tool_name,
                    elapsed_time_seconds: progressMsg.elapsed_time_seconds,
                  }),
                }),
              )
              break
            }

            case 'result': {
              const resultMsg = message as SDKResultMessage
              tokenUsage = extractTokenUsage(resultMsg)
              controller.enqueue(
                formatSSE({
                  type: 'result',
                  data: JSON.stringify({
                    subtype: resultMsg.subtype,
                    is_error: resultMsg.is_error,
                    num_turns: resultMsg.num_turns,
                    duration_ms: resultMsg.duration_ms,
                    usage: tokenUsage,
                    session_id: resultMsg.session_id,
                  }),
                }),
              )
              break
            }

            default: {
              if ((message as { type: string }).type === 'keep_alive') {
                controller.enqueue(formatSSE({ type: 'keep_alive', data: '' }))
              }
              break
            }
          }
        }

        logger.info('claude', 'Stream completed normally', {
          sessionId,
          totalMessages: messageCount,
        })
        controller.enqueue(formatSSE({ type: 'done', data: '' }))
        controller.close()
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error'
        const stack = error instanceof Error ? error.stack : undefined
        logger.error('claude', 'Stream error caught', {
          sessionId,
          error: msg,
          stack,
          errorType: error?.constructor?.name,
        })
        try {
          controller.enqueue(formatSSE({ type: 'error', data: msg }))
          controller.enqueue(formatSSE({ type: 'done', data: '' }))
          controller.close()
        } catch (closeErr) {
          logger.warn('claude', 'Failed to close controller after error', {
            sessionId,
            closeError: String(closeErr),
          })
        }
      } finally {
        activeConversations.delete(sessionId)
        logger.info('claude', 'Stream cleanup done', { sessionId })
      }
    },
  })
}
