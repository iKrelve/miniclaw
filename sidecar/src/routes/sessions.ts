/**
 * Session HTTP routes — CRUD for chat sessions
 */

import { Hono } from 'hono';
import {
  createSession,
  getSession,
  listSessions,
  updateSessionTitle,
  deleteSession,
  archiveSession,
  getMessages,
} from '../db';

const sessionRoutes = new Hono();

/** GET /sessions — List all sessions */
sessionRoutes.get('/', (c) => {
  const status = c.req.query('status') || 'active';
  const sessions = listSessions(status);
  return c.json({ sessions });
});

/** POST /sessions — Create a new session */
sessionRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { title, working_directory, model, mode, provider_id } = body;

  if (!working_directory) {
    return c.json({ error: 'working_directory is required' }, 400);
  }

  const session = createSession({
    title,
    working_directory,
    model,
    mode,
    provider_id,
  });
  return c.json({ session }, 201);
});

/** GET /sessions/:id — Get a session by ID */
sessionRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const session = getSession(id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  return c.json({ session });
});

/** PUT /sessions/:id — Update a session */
sessionRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const session = getSession(id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  if (body.title) {
    updateSessionTitle(id, body.title);
  }
  if (body.status === 'archived') {
    archiveSession(id);
  }

  const updated = getSession(id);
  return c.json({ session: updated });
});

/** DELETE /sessions/:id — Delete a session */
sessionRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  const session = getSession(id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  deleteSession(id);
  return c.json({ success: true });
});

/** GET /sessions/:id/messages — Get messages for a session */
sessionRoutes.get('/:id/messages', (c) => {
  const id = c.req.param('id');
  const session = getSession(id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  const messages = getMessages(id);
  return c.json({ messages });
});

export default sessionRoutes;
