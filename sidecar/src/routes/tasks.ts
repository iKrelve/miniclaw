/**
 * Tasks HTTP routes — CRUD for session tasks (TodoWrite)
 */

import { Hono } from 'hono'
import { createTask, getTasks, updateTaskStatus, deleteTask } from '../db'

const taskRoutes = new Hono()

/** GET /tasks?session_id=... */
taskRoutes.get('/', (c) => {
  const sessionId = c.req.query('session_id')
  if (!sessionId) return c.json({ error: 'session_id is required' }, 400)
  return c.json({ tasks: getTasks(sessionId) })
})

/** POST /tasks */
taskRoutes.post('/', async (c) => {
  const body = await c.req.json()
  const { session_id, content } = body
  if (!session_id || !content) {
    return c.json({ error: 'session_id and content are required' }, 400)
  }
  const task = createTask(session_id, content)
  return c.json({ task }, 201)
})

/** PUT /tasks/:id */
taskRoutes.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  if (body.status) {
    updateTaskStatus(id, body.status)
  }
  return c.json({ success: true })
})

/** DELETE /tasks/:id */
taskRoutes.delete('/:id', (c) => {
  const id = c.req.param('id')
  deleteTask(id)
  return c.json({ success: true })
})

export default taskRoutes
