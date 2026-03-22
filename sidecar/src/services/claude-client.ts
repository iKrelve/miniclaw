/**
 * 小龙虾 (MiniClaw) — Claude Client Service
 *
 * Wraps @anthropic-ai/claude-agent-sdk to produce SSE event streams.
 * Simplified from CodePilot's src/lib/claude-client.ts — no Telegram,
 * no image-agent, no Bridge. Pure AI conversation streaming.
 */

import {
  query,
  type SDKAssistantMessage,
  type SDKUserMessage,
  type SDKResultMessage,
  type SDKPartialAssistantMessage,
  type SDKSystemMessage,
  type SDKToolProgressMessage,
  type Options,
  type McpStdioServerConfig,
  type McpSSEServerConfig,
  type McpHttpServerConfig,
  type McpServerConfig as SdkMcpServerConfig,
  type PermissionResult,
} from '@anthropic-ai/claude-agent-sdk'
// SDK-embedded CLI: in dev mode returns the node_modules path directly;
// in `bun build --compile` extracts from $bunfs to a temp directory.
import embeddedCliPath from '@anthropic-ai/claude-agent-sdk/embed'
import type { McpServerConfig, TokenUsage, PermissionRequestEvent } from '../../../shared/types'
import { getSetting, getProvider, updateSdkSessionId } from '../db'
import { findClaudeBinary, getExpandedPath } from './platform'
import { captureModels } from './sdk-capabilities'
import { logger } from '../utils/logger'
import os from 'os'

// Pre-compiled regexes for stripping ANSI escapes and C0 control chars.
// These intentionally match control characters — suppress no-control-regex.
/* eslint-disable no-control-regex -- intentional: these regexes strip ANSI escapes and C0 control chars */
const RE_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g
const RE_ANSI_CSI = /\x1B\[[0-9;]*[a-zA-Z]/g
const RE_ANSI_OSC = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g
const RE_C0_STRIP = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g
/* eslint-enable no-control-regex */

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
      clean[key] = value.replace(RE_CONTROL_CHARS, '')
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
  /** File attachments saved to disk by the chat route.
   *  Images include base64 `data` for vision; non-images only have `path`. */
  files?: Array<{ path: string; name: string; type: string; data?: string }>
}

// ==========================================
// Pending Permissions
// ==========================================

interface PendingPermission {
  resolve: (result: PermissionResult) => void
  toolInput: Record<string, unknown>
}

const pendingPermissions = new Map<string, PendingPermission>()

export function resolvePermission(permissionId: string, allow: boolean, updatedInput?: unknown) {
  const pending = pendingPermissions.get(permissionId)
  if (!pending) return
  if (allow) {
    const result: PermissionResult = { behavior: 'allow' }
    // Use frontend-provided updatedInput if present, otherwise fall back
    // to the original toolInput captured at registration time.
    // The SDK requires updatedInput to re-execute the tool — without it
    // the tool receives empty/undefined input and fails.
    if (updatedInput && typeof updatedInput === 'object') {
      result.updatedInput = updatedInput as Record<string, unknown>
    } else {
      result.updatedInput = pending.toolInput
    }
    pending.resolve(result)
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
    files,
  } = options

  // Build the final prompt. When images are attached, we must use the SDK's
  // multi-modal format (AsyncIterable<SDKUserMessage> with image content blocks)
  // so the model receives them via the vision API — NOT as file path references.
  // Non-image files are referenced by path so the SDK reads them via the Read tool.
  function buildFinalPrompt(): string | AsyncIterable<SDKUserMessage> {
    if (!files || files.length === 0) return prompt

    const imageFiles = files.filter((f) => f.type.startsWith('image/') && f.data)
    const nonImageFiles = files.filter((f) => !f.type.startsWith('image/'))

    // Start with the user's text prompt
    let textPrompt = prompt

    // Non-image files: prepend path references so the model uses Read tool
    if (nonImageFiles.length > 0) {
      const fileRefs = nonImageFiles
        .map((f) => `[User attached file: ${f.path} (${f.name})]`)
        .join('\n')
      textPrompt = `${fileRefs}\n\nPlease read the attached file(s) above using your Read tool, then respond to the user's message:\n\n${prompt}`
    }

    // Images: build multi-modal SDKUserMessage with base64 content blocks
    if (imageFiles.length > 0) {
      const contentBlocks: Array<
        | {
            type: 'image'
            source: {
              type: 'base64'
              media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
              data: string
            }
          }
        | { type: 'text'; text: string }
      > = []

      for (const img of imageFiles) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: (img.type || 'image/png') as
              | 'image/jpeg'
              | 'image/png'
              | 'image/gif'
              | 'image/webp',
            data: img.data!,
          },
        })
      }

      // Append text prompt after all image blocks
      contentBlocks.push({ type: 'text', text: textPrompt })

      const userMessage: SDKUserMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: contentBlocks,
        },
        parent_tool_use_id: null,
        session_id: sdkSessionId || '',
      }

      logger.info('claude', 'Built multi-modal prompt with vision content blocks', {
        sessionId,
        imageCount: imageFiles.length,
        nonImageCount: nonImageFiles.length,
      })

      return (async function* () {
        yield userMessage
      })()
    }

    // No images, just return enriched text prompt
    return textPrompt
  }

  const finalPrompt = buildFinalPrompt()

  return new ReadableStream<string>({
    async start(controller) {
      const abortController = new AbortController()
      activeConversations.set(sessionId, { abort: abortController })

      // Expand ~ to home directory (Node/Bun child_process doesn't do shell expansion)
      const resolvedCwd = workingDirectory.startsWith('~')
        ? workingDirectory.replace(/^~/, os.homedir())
        : workingDirectory

      const isMultiModal = typeof finalPrompt !== 'string'
      logger.info('claude', 'streamChat.start', {
        sessionId,
        prompt: prompt.slice(0, 100),
        model,
        hasSystemPrompt: !!systemPrompt,
        workingDirectory,
        resolvedCwd,
        isMultiModal,
        fileCount: files?.length ?? 0,
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
          // Load user/project/local settings so the SDK discovers skills from
          // ~/.claude/skills/, loads CLAUDE.md, MCP servers from ~/.claude.json,
          // and respects user permissions. Same as CodePilot.
          settingSources: ['user', 'project', 'local'],
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

        // Resume session
        if (sdkSessionId) {
          queryOptions.resume = sdkSessionId
        }

        // Permission handler
        queryOptions.canUseTool = async (toolName, input, opts) => {
          // Log every canUseTool invocation for diagnostics
          logger.info('claude', 'canUseTool called', {
            sessionId,
            toolName,
            inputPreview: JSON.stringify(input).slice(0, 200),
          })

          // Auto-approve when session has full_access profile
          if (sessionBypass) {
            const updatedInput = (input && typeof input === 'object' ? input : {}) as Record<
              string,
              unknown
            >
            return { behavior: 'allow', updatedInput } as PermissionResult
          }

          // Auto-approve browser automation — covers both the Skill tool
          // (loading miniclaw-browser skill) and Bash tool (running CLI commands).
          // The skill's allowed-tools YAML doesn't reliably bypass the canUseTool
          // callback, so we handle it explicitly here.
          const inp = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
          const lowerTool = toolName.toLowerCase()

          // Skill tool: auto-approve when loading miniclaw-browser skill
          if (lowerTool === 'skill' && inp.skill === 'miniclaw-browser') {
            logger.info('claude', 'Auto-approved miniclaw-browser skill', { sessionId, toolName })
            return { behavior: 'allow', updatedInput: inp } as PermissionResult
          }

          // Bash tool: auto-approve browser CLI commands
          if (lowerTool === 'bash' || lowerTool === 'bashtool' || lowerTool.includes('bash')) {
            const cmd = (inp.command as string)?.trim()
            if (
              cmd &&
              (cmd.startsWith('miniclaw-desk browser-action') ||
                cmd.startsWith('miniclaw-desk browser') ||
                cmd.startsWith('agent-browser'))
            ) {
              logger.info('claude', 'Auto-approved browser command', {
                sessionId,
                toolName,
                cmd: cmd.slice(0, 100),
              })
              return { behavior: 'allow', updatedInput: inp } as PermissionResult
            }
          }

          // Read tool: auto-approve agent-browser screenshot files.
          // Screenshots are saved to ~/.agent-browser/tmp/screenshots/ which is
          // outside the session's cwd, triggering a sandbox permission request.
          // These files are safe (we control their creation via the screenshot command).
          if (lowerTool === 'read') {
            const filePath = (inp.file_path as string) || ''
            if (
              filePath.includes('.agent-browser') &&
              /screenshot.*\.(png|jpg|jpeg)$/i.test(filePath)
            ) {
              logger.info('claude', 'Auto-approved screenshot read', { sessionId, filePath })
              return { behavior: 'allow', updatedInput: inp } as PermissionResult
            }
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

          // Wait for user response — store original input so resolvePermission
          // can inject it back as updatedInput when the user allows.
          const toolInput = (input && typeof input === 'object' ? input : {}) as Record<
            string,
            unknown
          >
          return new Promise<PermissionResult>((resolve) => {
            pendingPermissions.set(permId, { resolve, toolInput })

            // Auto-deny if the SDK aborts (user interrupt / connection drop)
            const signal = (opts as Record<string, unknown>).signal as AbortSignal | undefined
            if (signal) {
              const onAbort = () => {
                if (pendingPermissions.has(permId)) {
                  pendingPermissions.delete(permId)
                  resolve({ behavior: 'deny', message: 'Request aborted' })
                }
              }
              signal.addEventListener('abort', onAbort, { once: true })
            }

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
          // Strip ANSI escape sequences and C0 control chars from stderr
          const cleaned = data
            .replace(RE_ANSI_CSI, '')
            .replace(RE_ANSI_OSC, '')
            .replace(RE_C0_STRIP, '')
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

        const conversation = query({ prompt: finalPrompt, options: queryOptions })

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
                if (delta.type === 'thinking_delta' && 'thinking' in delta && delta.thinking) {
                  // Thinking/reasoning content from extended thinking
                  controller.enqueue(formatSSE({ type: 'thinking', data: delta.thinking }))
                } else if ('text' in delta && delta.text) {
                  controller.enqueue(formatSSE({ type: 'text', data: delta.text }))
                }
              }
              break
            }

            case 'system': {
              const sysMsg = message as SDKSystemMessage
              if ('subtype' in sysMsg && sysMsg.subtype === 'init') {
                // Log SDK init details including skills for debugging
                const initAny = sysMsg as Record<string, unknown>
                logger.info('claude', 'SDK init received', {
                  sessionId,
                  model: sysMsg.model,
                  toolCount: Array.isArray(sysMsg.tools) ? sysMsg.tools.length : 0,
                  skills: initAny.skills,
                  plugins: initAny.plugins,
                })
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
