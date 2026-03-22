/**
 * Browser HTTP routes — start/stop/status for external Chrome management.
 */

import { Hono } from 'hono'
import { chromeManager } from '../services/chrome-manager'
import { shutdownBrowserBridges } from '../services/browser-tool'
import { logger } from '../utils/logger'

const browserRoutes = new Hono()

/**
 * POST /browser/start — Start external Chrome
 * Body: { headless?: boolean } (default false = headed mode)
 */
browserRoutes.post('/start', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    const headless = body.headless === true
    logger.info('browser', 'POST /browser/start', { headless })

    const info = await chromeManager.ensureRunning(headless)
    return c.json({ success: true, ...info })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('browser', 'POST /browser/start failed', { error: msg })
    return c.json({ success: false, error: msg }, 500)
  }
})

/**
 * POST /browser/stop — Stop external Chrome
 */
browserRoutes.post('/stop', async (c) => {
  logger.info('browser', 'POST /browser/stop')
  // Shutdown all agent-browser daemons first, then Chrome
  await shutdownBrowserBridges()
  await chromeManager.shutdown()
  return c.json({ success: true })
})

/**
 * GET /browser/status — Get Chrome status
 */
browserRoutes.get('/status', (c) => {
  const state = chromeManager.getState()
  return c.json({
    running: chromeManager.isRunning(),
    ...state,
  })
})

export default browserRoutes
