/**
 * Chat HTTP routes
 *
 * POST /chat          — fire-and-forget: starts a conversation, returns immediately
 * GET  /chat/events/:id — SSE: subscribe to a session's event stream (supports ?after=N for reconnect)
 * POST /chat/interrupt  — interrupt an active stream
 * POST /chat/permission — respond to a permission request
 */

import { Hono } from 'hono'
import { streamChat, interruptSession, resolvePermission } from '../services/claude-client'
import {
  getSession,
  addMessage,
  updateSessionTitle,
  updateSessionModel,
  updateSdkSessionId,
  acquireSessionLock,
  releaseSessionLock,
  setSessionRuntimeStatus,
  getSetting,
} from '../db'
import { loadMcpServers } from '../services/mcp-manager'
import type { McpServerConfig, FileAttachment } from '../../../shared/types'
import { logger } from '../utils/logger'
import { eventBuffer } from '../services/event-buffer'
import fs from 'fs'
import path from 'path'
import os from 'os'

const chatRoutes = new Hono()

// ==========================================
// POST /chat — fire-and-forget
// ==========================================

chatRoutes.post('/', async (c) => {
  const body = await c.req.json()
  const { session_id, content, model, mode, provider_id, systemPromptAppend, files } = body as {
    session_id: string
    content: string
    model?: string
    mode?: string
    provider_id?: string
    systemPromptAppend?: string
    files?: FileAttachment[]
  }

  logger.info('chat', 'POST /chat request', {
    session_id,
    contentLen: content?.length,
    model,
    mode,
    provider_id,
    fileCount: files?.length ?? 0,
  })

  if (!session_id || !content) {
    logger.warn('chat', 'Missing required fields', { session_id, hasContent: !!content })
    return c.json({ error: 'session_id and content are required' }, 400)
  }

  const session = getSession(session_id)
  if (!session) {
    logger.warn('chat', 'Session not found', { session_id })
    return c.json({ error: 'Session not found' }, 404)
  }

  // Acquire session lock (atomic CAS — prevents concurrent requests)
  const lockAcquired = acquireSessionLock(session_id)
  if (!lockAcquired) {
    logger.warn('chat', 'Session busy — lock not acquired', { session_id })
    return c.json({ error: 'Session is busy', code: 'SESSION_BUSY' }, 409)
  }

  // Save files to disk and build attachment list for the SDK.
  // Images: preserve base64 data (needed for vision multi-modal content blocks).
  // Non-images: only keep the file path (SDK reads them via Read tool).
  const fileAttachments: Array<{ path: string; name: string; type: string; data?: string }> = []
  if (files && files.length > 0) {
    const uploadDir = path.join(os.homedir(), '.miniclaw', 'uploads')
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
    for (const file of files) {
      const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_')
      const fileName = `${file.id}-${safeName}`
      const filePath = path.join(uploadDir, fileName)
      fs.writeFileSync(filePath, Buffer.from(file.data, 'base64'))
      fileAttachments.push({
        path: filePath,
        name: file.name,
        type: file.type,
        // Keep base64 for images so claude-client can build vision content blocks
        data: file.type.startsWith('image/') ? file.data : undefined,
      })
    }
    logger.info('chat', 'Files saved to disk', {
      count: fileAttachments.length,
      paths: fileAttachments.map((f) => f.path),
    })
  }

  // Build user message content with file metadata prefix (for history display).
  // Include filePath so FileAttachmentDisplay can load images from disk.
  const filesMeta =
    fileAttachments.length > 0
      ? `<!--files:${JSON.stringify(fileAttachments.map((f) => ({ name: f.name, type: f.type, filePath: f.path })))}-->`
      : ''
  const userContent = filesMeta + content

  // Save user message
  addMessage(session_id, 'user', userContent)

  // Auto-generate title from first message
  if (session.title === 'New Chat') {
    const title = content.slice(0, 50) + (content.length > 50 ? '...' : '')
    updateSessionTitle(session_id, title)
  }

  // Resolve model
  const effectiveModel =
    model || (session.model as string) || getSetting('default_model') || undefined
  if (effectiveModel && effectiveModel !== session.model) {
    updateSessionModel(session_id, effectiveModel)
  }

  // Load MCP servers
  const mcpServers = loadMcpServers()

  // Build system prompt
  let systemPrompt = (session.system_prompt as string) || undefined
  if (systemPromptAppend) {
    systemPrompt = (systemPrompt || '') + '\n\n' + systemPromptAppend
  }

  logger.info('chat', 'Starting background stream', {
    session_id,
    effectiveModel,
    hasSdkSessionId: !!(session.sdk_session_id as string),
    workingDirectory: (session.working_directory as string) || process.cwd(),
    mcpServerCount: mcpServers ? Object.keys(mcpServers).length : 0,
    mode: mode || session.mode,
    fileCount: fileAttachments.length,
  })

  setSessionRuntimeStatus(session_id, 'running')

  // Reset stale buffer from a previous conversation on this session.
  // Use reset() instead of clear() to preserve existing SSE subscribers —
  // the frontend may have already connected via GET /chat/events/:id.
  eventBuffer.reset(session_id)

  // Fire-and-forget: consume the SDK stream in the background, push events to EventBuffer
  consumeStreamInBackground(session_id, {
    prompt: content,
    sdkSessionId: (session.sdk_session_id as string) || undefined,
    model: effectiveModel,
    systemPrompt,
    workingDirectory: (session.working_directory as string) || process.cwd(),
    mcpServers: mcpServers || undefined,
    mode: (mode || session.mode) as 'code' | 'plan' | 'ask',
    permissionProfile: (session.permission_profile as 'default' | 'full_access') || 'default',
    providerId: provider_id || (session.provider_id as string) || undefined,
    files: fileAttachments.length > 0 ? fileAttachments : undefined,
  })

  // Return immediately — frontend subscribes via GET /chat/events/:id
  return c.json({ ok: true, session_id })
})

// ==========================================
// GET /chat/events/:id — SSE event stream
// ==========================================

chatRoutes.get('/events/:id', (c) => {
  const sessionId = c.req.param('id')
  const afterParam = c.req.query('after')
  const afterIndex = afterParam != null ? parseInt(afterParam, 10) : undefined

  logger.info('chat', 'SSE subscribe', { sessionId, afterIndex })

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const send = (type: string, data: unknown, index: number) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data, index })}\n\n`))
        } catch {
          // controller closed
        }
      }

      // Subscribe to EventBuffer — replays missed events automatically
      const unsub = eventBuffer.subscribe(
        sessionId,
        (event) => {
          send(event.type, event.data, event.index)

          // Close the SSE connection after 'done' event
          if (event.type === 'done') {
            cleanup()
            try {
              controller.close()
            } catch {
              // already closed
            }
          }
        },
        afterIndex,
      )

      // Heartbeat every 5s to prevent connection timeout
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 5_000)

      const cleanup = () => {
        unsub()
        clearInterval(heartbeat)
      }

      // Client disconnect
      c.req.raw.signal.addEventListener('abort', () => {
        logger.debug('chat', 'SSE client disconnected', { sessionId })
        cleanup()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })

      // If the buffer already completed before we subscribed and all events
      // were replayed in subscribe(), close the stream.
      if (eventBuffer.isDone(sessionId) && !c.req.raw.signal.aborted) {
        // Events were already replayed by subscribe(). Close after a brief delay
        // to let the flush happen.
        setTimeout(() => {
          cleanup()
          try {
            controller.close()
          } catch {
            // already closed
          }
        }, 100)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

// ==========================================
// POST /chat/interrupt
// ==========================================

chatRoutes.post('/interrupt', async (c) => {
  const { session_id } = await c.req.json()
  if (!session_id) {
    return c.json({ error: 'session_id is required' }, 400)
  }
  const interrupted = interruptSession(session_id)
  return c.json({ success: interrupted })
})

// ==========================================
// POST /chat/permission
// ==========================================

chatRoutes.post('/permission', async (c) => {
  const { permission_id, allow, updated_input } = await c.req.json()
  if (!permission_id) {
    return c.json({ error: 'permission_id is required' }, 400)
  }
  resolvePermission(permission_id, allow ?? false, updated_input)
  return c.json({ success: true })
})

// ==========================================
// Background stream consumer
// ==========================================

interface BackgroundStreamOptions {
  prompt: string
  sdkSessionId?: string
  model?: string
  systemPrompt?: string
  workingDirectory: string
  mcpServers?: Record<string, McpServerConfig>
  mode?: 'code' | 'plan' | 'ask'
  permissionProfile?: 'default' | 'full_access'
  providerId?: string
  files?: Array<{ path: string; name: string; type: string; data?: string }>
}

/**
 * Consumes the SDK ReadableStream in the sidecar process (not in the WebView),
 * pushes each SSE event into the EventBuffer, and persists the assistant
 * message to the DB when done.
 */
function consumeStreamInBackground(sessionId: string, opts: BackgroundStreamOptions): void {
  const stream = streamChat({
    prompt: opts.prompt,
    sessionId,
    sdkSessionId: opts.sdkSessionId,
    model: opts.model,
    systemPrompt: opts.systemPrompt,
    workingDirectory: opts.workingDirectory,
    mcpServers: opts.mcpServers,
    mode: opts.mode,
    permissionProfile: opts.permissionProfile,
    providerId: opts.providerId,
    files: opts.files,
  })

  // Structured content blocks for DB persistence (same as before)
  interface ContentBlock {
    type: string
    text?: string
    id?: string
    name?: string
    input?: unknown
    tool_use_id?: string
    content?: string
    is_error?: boolean
  }
  const contentBlocks: ContentBlock[] = []
  let currentText = ''
  let tokenUsage: string | null = null
  const seenToolResultIds = new Set<string>()

  const reader = stream.getReader()

  ;(async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Each `value` is an SSE-formatted string: "data: {...}\n\n"
        if (!value.startsWith('data: ')) continue

        let parsed: { type: string; data: unknown }
        try {
          parsed = JSON.parse(value.slice(6).trim())
        } catch {
          continue
        }

        // Push to EventBuffer for real-time subscribers
        eventBuffer.push(sessionId, parsed.type, parsed.data)

        // Collect structured content for DB persistence
        if (parsed.type === 'text' && typeof parsed.data === 'string') {
          currentText += parsed.data
        } else if (parsed.type === 'tool_use') {
          if (currentText.trim()) {
            contentBlocks.push({ type: 'text', text: currentText })
            currentText = ''
          }
          try {
            const td = JSON.parse(parsed.data as string)
            contentBlocks.push({ type: 'tool_use', id: td.id, name: td.name, input: td.input })
          } catch {
            /* skip */
          }
        } else if (parsed.type === 'tool_result') {
          try {
            const rd = JSON.parse(parsed.data as string)
            const block: ContentBlock = {
              type: 'tool_result',
              tool_use_id: rd.tool_use_id,
              content: rd.content,
              is_error: rd.is_error || false,
            }
            if (seenToolResultIds.has(rd.tool_use_id)) {
              const idx = contentBlocks.findIndex(
                (b) => b.type === 'tool_result' && b.tool_use_id === rd.tool_use_id,
              )
              if (idx >= 0) contentBlocks[idx] = block
            } else {
              seenToolResultIds.add(rd.tool_use_id)
              contentBlocks.push(block)
            }
          } catch {
            /* skip */
          }
        } else if (parsed.type === 'result') {
          try {
            const rd = JSON.parse(parsed.data as string)
            if (rd.usage) tokenUsage = JSON.stringify(rd.usage)
            if (rd.session_id) {
              try {
                updateSdkSessionId(sessionId, rd.session_id)
              } catch {
                /* best effort */
              }
            }
          } catch {
            /* skip */
          }
        } else if (parsed.type === 'status') {
          try {
            const sd = JSON.parse(parsed.data as string)
            if (sd.session_id) {
              try {
                updateSdkSessionId(sessionId, sd.session_id)
              } catch {
                /* best effort */
              }
            }
            if (sd.model) updateSessionModel(sessionId, sd.model)
          } catch {
            /* skip */
          }
        }
      }

      logger.info('chat', 'Background stream completed', {
        sessionId,
        blockCount: contentBlocks.length,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('chat', 'Background stream error', { sessionId, error: msg })
      eventBuffer.push(sessionId, 'error', msg)
    } finally {
      // Flush remaining text
      if (currentText.trim()) {
        contentBlocks.push({ type: 'text', text: currentText })
      }

      // Persist assistant message
      if (contentBlocks.length > 0) {
        try {
          const hasTools = contentBlocks.some(
            (b) => b.type === 'tool_use' || b.type === 'tool_result',
          )
          const finalContent = hasTools
            ? JSON.stringify(contentBlocks)
            : contentBlocks
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('')
                .trim()
          if (finalContent) {
            addMessage(sessionId, 'assistant', finalContent, tokenUsage)
          }
        } catch {
          /* best effort */
        }
      }

      // Push final done event if not already done
      if (!eventBuffer.isDone(sessionId)) {
        eventBuffer.push(sessionId, 'done', '')
      }

      releaseSessionLock(sessionId)
      setSessionRuntimeStatus(sessionId, 'idle')
      logger.info('chat', 'Background stream cleanup done', { sessionId })
    }
  })()
}

export default chatRoutes
