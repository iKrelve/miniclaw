/**
 * 小龙虾 (MiniClaw) — Claude Client Service
 *
 * Wraps @anthropic-ai/claude-agent-sdk to produce SSE event streams.
 * Simplified from CodePilot's src/lib/claude-client.ts — no Telegram,
 * no image-agent, no Bridge. Pure AI conversation streaming.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKPartialAssistantMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
  Options,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpServerConfig as SdkMcpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig, TokenUsage, PermissionRequestEvent } from '../../../shared/types';
import { getSetting, getProvider, updateSdkSessionId } from '../db';
import { findClaudeBinary, getExpandedPath } from './platform';
import os from 'os';
import fs from 'fs';
import path from 'path';

// ==========================================
// Active conversations registry (for interrupt)
// ==========================================

const activeConversations = new Map<string, { abort: AbortController }>();

export function interruptSession(sessionId: string): boolean {
  const entry = activeConversations.get(sessionId);
  if (entry) {
    entry.abort.abort();
    activeConversations.delete(sessionId);
    return true;
  }
  return false;
}

// ==========================================
// SSE Formatting
// ==========================================

interface SSEEvent {
  type: string;
  data: unknown;
}

function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ==========================================
// MCP Config Conversion
// ==========================================

function toSdkMcpConfig(servers: Record<string, McpServerConfig>): Record<string, SdkMcpServerConfig> {
  const result: Record<string, SdkMcpServerConfig> = {};
  for (const [name, config] of Object.entries(servers)) {
    const transport = config.type || 'stdio';
    switch (transport) {
      case 'sse': {
        if (!config.url) continue;
        const sseConfig: McpSSEServerConfig = { type: 'sse', url: config.url };
        if (config.headers && Object.keys(config.headers).length > 0) {
          sseConfig.headers = config.headers;
        }
        result[name] = sseConfig;
        break;
      }
      case 'http': {
        if (!config.url) continue;
        const httpConfig: McpHttpServerConfig = { type: 'http', url: config.url };
        if (config.headers && Object.keys(config.headers).length > 0) {
          httpConfig.headers = config.headers;
        }
        result[name] = httpConfig;
        break;
      }
      case 'stdio':
      default: {
        if (!config.command) continue;
        const stdioConfig: McpStdioServerConfig = {
          command: config.command,
          args: config.args,
          env: config.env,
        };
        result[name] = stdioConfig;
        break;
      }
    }
  }
  return result;
}

// ==========================================
// Token Usage Extraction
// ==========================================

function extractTokenUsage(msg: SDKResultMessage): TokenUsage | null {
  if (!msg.usage) return null;
  return {
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
  };
}

// ==========================================
// Env Sanitization
// ==========================================

function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      clean[key] = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }
  }
  return clean;
}

// ==========================================
// Stream Options
// ==========================================

export interface StreamChatOptions {
  prompt: string;
  sessionId: string;
  sdkSessionId?: string;
  model?: string;
  systemPrompt?: string;
  workingDirectory: string;
  mcpServers?: Record<string, McpServerConfig>;
  mode?: 'code' | 'plan' | 'ask';
  permissionMode?: string;
  providerId?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// ==========================================
// Pending Permissions
// ==========================================

interface PendingPermission {
  resolve: (result: { behavior: 'allow' | 'deny'; updatedInput?: unknown }) => void;
}

const pendingPermissions = new Map<string, PendingPermission>();

export function resolvePermission(permissionId: string, allow: boolean, updatedInput?: unknown) {
  const pending = pendingPermissions.get(permissionId);
  if (pending) {
    pending.resolve({ behavior: allow ? 'allow' : 'deny', updatedInput });
    pendingPermissions.delete(permissionId);
  }
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
    mode,
    permissionMode,
    providerId,
  } = options;

  return new ReadableStream<string>({
    async start(controller) {
      const abortController = new AbortController();
      activeConversations.set(sessionId, { abort: abortController });

      try {
        // Build environment
        const sdkEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
        if (!sdkEnv.HOME) sdkEnv.HOME = os.homedir();
        if (!sdkEnv.USERPROFILE) sdkEnv.USERPROFILE = os.homedir();
        sdkEnv.PATH = getExpandedPath();
        delete sdkEnv.CLAUDECODE;

        // Inject API proxy env vars from provider config or global settings.
        // Priority: provider base_url/api_key > settings > process.env (already in sdkEnv)
        if (providerId) {
          const provider = getProvider(providerId) as Record<string, unknown> | undefined;
          if (provider?.base_url) sdkEnv.ANTHROPIC_BASE_URL = provider.base_url as string;
          if (provider?.api_key) sdkEnv.ANTHROPIC_AUTH_TOKEN = provider.api_key as string;
        }
        // Global settings fallback (user-configured via Settings UI)
        const settingsBaseUrl = getSetting('anthropic_base_url');
        const settingsAuthToken = getSetting('anthropic_auth_token');
        const settingsCustomHeaders = getSetting('anthropic_custom_headers');
        const settingsModel = getSetting('anthropic_model');
        if (settingsBaseUrl && !sdkEnv.ANTHROPIC_BASE_URL) sdkEnv.ANTHROPIC_BASE_URL = settingsBaseUrl;
        if (settingsAuthToken && !sdkEnv.ANTHROPIC_AUTH_TOKEN) sdkEnv.ANTHROPIC_AUTH_TOKEN = settingsAuthToken;
        if (settingsCustomHeaders && !sdkEnv.ANTHROPIC_CUSTOM_HEADERS) sdkEnv.ANTHROPIC_CUSTOM_HEADERS = settingsCustomHeaders;
        if (settingsModel && !model && !sdkEnv.ANTHROPIC_MODEL) sdkEnv.ANTHROPIC_MODEL = settingsModel;

        // Check if bypass permissions
        const globalSkip = getSetting('dangerously_skip_permissions') === 'true';

        const queryOptions: Options = {
          cwd: workingDirectory || os.homedir(),
          abortController,
          includePartialMessages: true,
          permissionMode: globalSkip
            ? 'bypassPermissions'
            : ((permissionMode as Options['permissionMode']) || 'acceptEdits'),
          env: sanitizeEnv(sdkEnv),
        };

        if (globalSkip) {
          queryOptions.allowDangerouslySkipPermissions = true;
        }

        // Find claude binary
        const claudePath = findClaudeBinary();
        if (claudePath) {
          queryOptions.pathToClaudeCodeExecutable = claudePath;
        }

        if (model) queryOptions.model = model;

        if (systemPrompt) {
          queryOptions.systemPrompt = {
            type: 'preset',
            preset: 'claude_code',
            append: systemPrompt,
          };
        }

        // MCP servers
        if (mcpServers && Object.keys(mcpServers).length > 0) {
          queryOptions.mcpServers = toSdkMcpConfig(mcpServers);
        }

        // Resume session
        if (sdkSessionId) {
          queryOptions.resume = sdkSessionId;
        }

        // Permission handler
        queryOptions.canUseTool = async (toolName, input, opts) => {
          const permId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const permEvent: PermissionRequestEvent = {
            id: permId,
            tool_name: toolName,
            description: (opts as Record<string, unknown>).decisionReason as string || '',
            input,
          };

          controller.enqueue(formatSSE({
            type: 'permission_request',
            data: JSON.stringify(permEvent),
          }));

          // Wait for user response
          return new Promise((resolve) => {
            pendingPermissions.set(permId, { resolve });
            // Auto-timeout after 5 minutes
            setTimeout(() => {
              if (pendingPermissions.has(permId)) {
                pendingPermissions.delete(permId);
                resolve({ behavior: 'deny' });
              }
            }, 5 * 60 * 1000);
          });
        };

        // Capture stderr
        queryOptions.stderr = (data: string) => {
          const cleaned = data
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();
          if (cleaned) {
            controller.enqueue(formatSSE({ type: 'tool_output', data: cleaned }));
          }
        };

        // Start conversation
        const conversation = query({ prompt, options: queryOptions });

        let tokenUsage: TokenUsage | null = null;

        for await (const message of conversation) {
          if (abortController.signal.aborted) break;

          switch (message.type) {
            case 'assistant': {
              const assistantMsg = message as SDKAssistantMessage;
              for (const block of assistantMsg.message.content) {
                if (block.type === 'tool_use') {
                  controller.enqueue(formatSSE({
                    type: 'tool_use',
                    data: JSON.stringify({
                      id: block.id,
                      name: block.name,
                      input: block.input,
                    }),
                  }));
                }
              }
              break;
            }

            case 'user': {
              const userMsg = message as SDKUserMessage;
              const content = userMsg.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    const resultContent = typeof block.content === 'string'
                      ? block.content
                      : Array.isArray(block.content)
                        ? block.content
                            .filter((c: Record<string, unknown>) => c.type === 'text')
                            .map((c: Record<string, unknown>) => c.text)
                            .join('\n')
                        : String(block.content ?? '');
                    controller.enqueue(formatSSE({
                      type: 'tool_result',
                      data: JSON.stringify({
                        tool_use_id: block.tool_use_id,
                        content: resultContent,
                        is_error: block.is_error || false,
                      }),
                    }));
                  }
                }
              }
              break;
            }

            case 'stream_event': {
              const streamEvent = message as SDKPartialAssistantMessage;
              const evt = streamEvent.event;
              if (evt.type === 'content_block_delta' && 'delta' in evt) {
                const delta = evt.delta as Record<string, unknown>;
                if ('text' in delta && delta.text) {
                  controller.enqueue(formatSSE({ type: 'text', data: delta.text }));
                }
              }
              break;
            }

            case 'system': {
              const sysMsg = message as SDKSystemMessage;
              if ('subtype' in sysMsg && sysMsg.subtype === 'init') {
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({
                    session_id: sysMsg.session_id,
                    model: sysMsg.model,
                    tools: sysMsg.tools,
                  }),
                }));
                // Save SDK session ID for resume
                if (sysMsg.session_id && sessionId) {
                  try { updateSdkSessionId(sessionId, sysMsg.session_id); } catch { /* best effort */ }
                }
              }
              break;
            }

            case 'tool_progress': {
              const progressMsg = message as SDKToolProgressMessage;
              controller.enqueue(formatSSE({
                type: 'tool_output',
                data: JSON.stringify({
                  _progress: true,
                  tool_use_id: progressMsg.tool_use_id,
                  tool_name: progressMsg.tool_name,
                  elapsed_time_seconds: progressMsg.elapsed_time_seconds,
                }),
              }));
              break;
            }

            case 'result': {
              const resultMsg = message as SDKResultMessage;
              tokenUsage = extractTokenUsage(resultMsg);
              controller.enqueue(formatSSE({
                type: 'result',
                data: JSON.stringify({
                  subtype: resultMsg.subtype,
                  is_error: resultMsg.is_error,
                  num_turns: resultMsg.num_turns,
                  duration_ms: resultMsg.duration_ms,
                  usage: tokenUsage,
                  session_id: resultMsg.session_id,
                }),
              }));
              break;
            }

            default: {
              if ((message as { type: string }).type === 'keep_alive') {
                controller.enqueue(formatSSE({ type: 'keep_alive', data: '' }));
              }
              break;
            }
          }
        }

        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[claude-client] Stream error:', msg);
        try {
          controller.enqueue(formatSSE({ type: 'error', data: msg }));
          controller.enqueue(formatSSE({ type: 'done', data: '' }));
          controller.close();
        } catch {
          // controller may already be closed
        }
      } finally {
        activeConversations.delete(sessionId);
      }
    },
  });
}
