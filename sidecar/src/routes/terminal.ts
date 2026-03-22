/**
 * Terminal routes — HTTP for lifecycle, WebSocket for I/O streaming.
 *
 * POST   /terminal         — create a new terminal session
 * DELETE /terminal/:id      — kill a terminal session
 * GET    /terminal/:id/ws   — upgrade to WebSocket for real-time I/O
 */

import { Hono } from 'hono';
import {
  createTerminalSession,
  getTerminalSession,
  writeToTerminal,
  killTerminalSession,
} from '../services/terminal';
import crypto from 'crypto';

const terminalRoutes = new Hono();

/** POST /terminal — Create a new terminal session */
terminalRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = crypto.randomUUID();
  const session = createTerminalSession(id, body.cwd);
  return c.json({ id: session.id, cwd: session.cwd }, 201);
});

/**
 * GET /terminal/:id/ws — WebSocket endpoint for real-time terminal I/O.
 *
 * This is handled at the Bun.serve level (see index.ts websocket config).
 * This route returns a 426 hint if accessed without upgrade.
 */
terminalRoutes.get('/:id/ws', (c) => {
  // Bun.serve handles the actual upgrade; if we reach here, upgrade failed
  return c.json({ error: 'WebSocket upgrade required' }, 426);
});

/** DELETE /terminal/:id — Kill a terminal session */
terminalRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  const ok = killTerminalSession(id);
  if (!ok) return c.json({ error: 'Terminal session not found' }, 404);
  return c.json({ success: true });
});

export default terminalRoutes;
