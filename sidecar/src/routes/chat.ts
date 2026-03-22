/**
 * Chat HTTP routes — POST /chat (SSE stream), POST /chat/interrupt
 */

import { Hono } from 'hono';
import { streamChat, interruptSession, resolvePermission } from '../services/claude-client';
import {
  getSession,
  addMessage,
  updateSessionTitle,
  updateSessionModel,
  acquireSessionLock,
  releaseSessionLock,
  setSessionRuntimeStatus,
  getSetting,
} from '../db';
import { loadMcpServers } from '../services/mcp-manager';
import { logger } from '../utils/logger';

const chatRoutes = new Hono();

/**
 * POST /chat — Send a message and receive SSE stream
 */
chatRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { session_id, content, model, mode, provider_id, files } = body;

  logger.info('chat', 'POST /chat request', { session_id, contentLen: content?.length, model, mode, provider_id });

  if (!session_id || !content) {
    logger.warn('chat', 'Missing required fields', { session_id, hasContent: !!content });
    return c.json({ error: 'session_id and content are required' }, 400);
  }

  const session = getSession(session_id);
  if (!session) {
    logger.warn('chat', 'Session not found', { session_id });
    return c.json({ error: 'Session not found' }, 404);
  }

  // Acquire session lock (atomic CAS — prevents concurrent requests)
  const lockAcquired = acquireSessionLock(session_id);
  if (!lockAcquired) {
    logger.warn('chat', 'Session busy — lock not acquired', { session_id });
    return c.json({ error: 'Session is busy', code: 'SESSION_BUSY' }, 409);
  }

  try {
    // Save user message
    addMessage(session_id, 'user', content);

    // Auto-generate title from first message
    if (session.title === 'New Chat') {
      const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
      updateSessionTitle(session_id, title);
    }

    // Resolve model
    const effectiveModel = model || (session.model as string) || getSetting('default_model') || undefined;
    if (effectiveModel && effectiveModel !== session.model) {
      updateSessionModel(session_id, effectiveModel);
    }

    // Load MCP servers
    const mcpServers = loadMcpServers();

    // Build system prompt from workspace config (if any)
    let systemPrompt = (session.system_prompt as string) || undefined;

    logger.info('chat', 'Creating SSE stream', {
      session_id,
      effectiveModel,
      hasSdkSessionId: !!(session.sdk_session_id as string),
      workingDirectory: (session.working_directory as string) || process.cwd(),
      mcpServerCount: mcpServers ? Object.keys(mcpServers).length : 0,
      mode: (mode || session.mode),
    });

    // Create the SSE stream
    const stream = streamChat({
      prompt: content,
      sessionId: session_id,
      sdkSessionId: (session.sdk_session_id as string) || undefined,
      model: effectiveModel,
      systemPrompt,
      workingDirectory: (session.working_directory as string) || process.cwd(),
      mcpServers: mcpServers || undefined,
      mode: (mode || session.mode) as 'code' | 'plan' | 'ask',
      providerId: provider_id || (session.provider_id as string) || undefined,
    });

    setSessionRuntimeStatus(session_id, 'running');

    // Collect assistant response for DB persistence
    let assistantText = '';
    const transformedStream = new ReadableStream<string>({
      async start(controller) {
        logger.info('chat', 'transformedStream.start — begin reading inner stream', { session_id });
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              logger.info('chat', 'Inner stream done', { session_id, assistantTextLen: assistantText.length });
              break;
            }
            controller.enqueue(value);

            // Parse SSE to collect text for persistence
            if (value.startsWith('data: ')) {
              try {
                const eventData = JSON.parse(value.slice(6).trim());
                if (eventData.type === 'text' && typeof eventData.data === 'string') {
                  assistantText += eventData.data;
                } else if (eventData.type === 'error') {
                  logger.error('chat', 'SSE error event from inner stream', { session_id, error: eventData.data });
                }
              } catch {
                // ignore parse errors
              }
            }
          }
          controller.close();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('chat', 'transformedStream read error', { session_id, error: errMsg, stack: err instanceof Error ? err.stack : undefined });
          // Ensure lock is released even on error
          releaseSessionLock(session_id);
          setSessionRuntimeStatus(session_id, 'idle');
          controller.error(err);
          return; // skip finally double-release
        } finally {
          // Persist assistant message
          if (assistantText) {
            try { addMessage(session_id, 'assistant', assistantText); } catch { /* best effort */ }
          }
          releaseSessionLock(session_id);
          setSessionRuntimeStatus(session_id, 'idle');
          logger.info('chat', 'transformedStream.finally — lock released', { session_id });
        }
      },
    });

    // Return SSE response
    return new Response(transformedStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start chat';
    logger.error('chat', 'Outer catch — releasing lock', { session_id, error: msg, stack: error instanceof Error ? error.stack : undefined });
    releaseSessionLock(session_id);
    setSessionRuntimeStatus(session_id, 'idle');
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /chat/interrupt — Interrupt an active stream
 */
chatRoutes.post('/interrupt', async (c) => {
  const { session_id } = await c.req.json();
  if (!session_id) {
    return c.json({ error: 'session_id is required' }, 400);
  }
  const interrupted = interruptSession(session_id);
  return c.json({ success: interrupted });
});

/**
 * POST /chat/permission — Respond to a permission request
 */
chatRoutes.post('/permission', async (c) => {
  const { permission_id, allow, updated_input } = await c.req.json();
  if (!permission_id) {
    return c.json({ error: 'permission_id is required' }, 400);
  }
  resolvePermission(permission_id, allow ?? false, updated_input);
  return c.json({ success: true });
});

export default chatRoutes;
