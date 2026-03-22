/**
 * Terminal HTTP routes — create/write/kill terminal sessions.
 * Frontend uses these + polling stdout for basic terminal integration.
 * Full PTY with WebSocket can be added later.
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

/** POST /terminal/:id/write — Write input to terminal */
terminalRoutes.post('/:id/write', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { data } = body as { data: string };
  if (!data) return c.json({ error: 'data is required' }, 400);

  const ok = writeToTerminal(id, data);
  if (!ok) return c.json({ error: 'Terminal session not found' }, 404);
  return c.json({ success: true });
});

/** GET /terminal/:id/read — Read available stdout (non-blocking) */
terminalRoutes.get('/:id/read', async (c) => {
  const id = c.req.param('id');
  const session = getTerminalSession(id);
  if (!session) return c.json({ error: 'Terminal session not found' }, 404);

  // Read available data with a short timeout
  try {
    const reader = session.proc.stdout.getReader();
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 100),
      ),
    ]);
    reader.releaseLock();

    if (result.value) {
      const text = new TextDecoder().decode(result.value);
      return c.json({ data: text });
    }
    return c.json({ data: '' });
  } catch {
    return c.json({ data: '' });
  }
});

/** DELETE /terminal/:id — Kill a terminal session */
terminalRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  const ok = killTerminalSession(id);
  if (!ok) return c.json({ error: 'Terminal session not found' }, 404);
  return c.json({ success: true });
});

export default terminalRoutes;
