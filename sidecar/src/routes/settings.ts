/**
 * Settings HTTP routes — GET/PUT key-value settings
 */

import { Hono } from 'hono'
import { getSetting, setSetting, getAllSettings } from '../db'

const settingsRoutes = new Hono()

/** GET /settings — Get all settings */
settingsRoutes.get('/', (c) => {
  return c.json({ settings: getAllSettings() })
})

/** GET /settings/:key — Get a specific setting */
settingsRoutes.get('/:key', (c) => {
  const key = c.req.param('key')
  const value = getSetting(key)
  if (value === undefined) {
    return c.json({ error: 'Setting not found' }, 404)
  }
  return c.json({ key, value })
})

/** PUT /settings — Update settings (bulk) */
settingsRoutes.put('/', async (c) => {
  const body = await c.req.json()
  const { settings } = body as { settings: Record<string, string> }
  if (!settings || typeof settings !== 'object') {
    return c.json({ error: 'settings object is required' }, 400)
  }
  for (const [key, value] of Object.entries(settings)) {
    setSetting(key, String(value))
  }
  return c.json({ success: true })
})

/** PUT /settings/:key — Update a single setting */
settingsRoutes.put('/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json()
  const { value } = body
  if (value === undefined) {
    return c.json({ error: 'value is required' }, 400)
  }
  setSetting(key, String(value))
  return c.json({ success: true })
})

export default settingsRoutes
