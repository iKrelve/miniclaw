/**
 * Browser HTTP routes — Chrome lifecycle + browser action execution.
 *
 * Routes:
 *   POST /browser/start    — Start external Chrome
 *   POST /browser/stop     — Stop Chrome + all daemons
 *   GET  /browser/status   — Chrome status + agent-browser availability
 *   POST /browser/action   — Execute a browser command (called by miniclaw-desk CLI)
 */

import { Hono } from 'hono'
import { chromeManager } from '../services/chrome-manager'
import {
  shutdownBrowserBridges,
  executeBrowserAction,
  isAgentBrowserAvailable,
} from '../services/browser-tool'
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
  await shutdownBrowserBridges()
  await chromeManager.shutdown()
  return c.json({ success: true })
})

/**
 * GET /browser/status — Get Chrome + tool status
 */
browserRoutes.get('/status', (c) => {
  const state = chromeManager.getState()
  const running = chromeManager.isRunning()
  const toolReady = running && isAgentBrowserAvailable()

  return c.json({
    running,
    toolReady,
    ...state,
  })
})

/**
 * POST /browser/action — Execute a browser command via agent-browser CLI.
 * Called by the miniclaw-desk CLI client.
 *
 * Body: { action: string, args?: string[], sessionId?: string }
 */
browserRoutes.post('/action', async (c) => {
  try {
    const body = await c.req.json()
    const { action, args, sessionId } = body

    if (!action || typeof action !== 'string') {
      return c.json({ success: false, error: 'action is required' }, 400)
    }

    logger.info('browser', 'POST /browser/action', { action, args, sessionId })

    const result = await executeBrowserAction({ action, args, sessionId })
    return c.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('browser', 'POST /browser/action failed', { error: msg })
    return c.json({ success: false, error: msg }, 500)
  }
})

export default browserRoutes
