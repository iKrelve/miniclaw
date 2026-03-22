/**
 * Chrome Manager — manages an external Chrome process for browser automation.
 *
 * Launches Chrome with --remote-debugging-port so the browser_action tool
 * can control it via CDP. Supports headed (visible window) and headless modes.
 *
 * Adapted from Jarvis externalChrome.ts, simplified for MiniClaw:
 * - No SSO cookie injection (no Meituan SSO)
 * - No Electron dependency (uses Bun.spawn)
 * - Profile stored in ~/.miniclaw/browser-profile
 */

import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { platform } from 'os'
import { logger } from '../utils/logger'
import { getAvailablePort } from '../utils/port'

type ChromeState = 'idle' | 'starting' | 'running' | 'error'

const CDP_READY_TIMEOUT = 15_000
const CDP_PROBE_INTERVAL = 300
const HEALTH_CHECK_INTERVAL = 10_000

// Chrome path discovery per platform
function findChromePath(): string | null {
  const os = platform()

  if (os === 'darwin') {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    for (const p of paths) {
      if (existsSync(p)) return p
    }
  } else if (os === 'linux') {
    const paths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ]
    for (const p of paths) {
      if (existsSync(p)) return p
    }
  } else if (os === 'win32') {
    const local = process.env.LOCALAPPDATA || ''
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const paths = [
      join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]
    for (const p of paths) {
      if (existsSync(p)) return p
    }
  }

  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const DATA_DIR = process.env.MINICLAW_DATA_DIR || join(require('os').homedir(), '.miniclaw')
const PROFILE_DIR = join(DATA_DIR, 'browser-profile')

class ChromeManager {
  private proc: ReturnType<typeof Bun.spawn> | null = null
  private cdpPort: number | null = null
  private state: ChromeState = 'idle'
  private _headless = false
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private chromePath: string | null = null
  private startPromise: Promise<void> | null = null

  // --- Public API ---

  async ensureRunning(headless = false): Promise<{ cdpPort: number; headless: boolean }> {
    if (this.state === 'running' && this.cdpPort && this.isAlive()) {
      // If mode changed, restart
      if (headless !== this._headless) {
        logger.info('browser', 'Mode changed, restarting Chrome', {
          from: this._headless ? 'headless' : 'headed',
          to: headless ? 'headless' : 'headed',
        })
        await this.shutdown()
      } else {
        return { cdpPort: this.cdpPort, headless: this._headless }
      }
    }

    // Prevent concurrent starts
    if (this.startPromise) {
      await this.startPromise
      return { cdpPort: this.cdpPort!, headless: this._headless }
    }

    this.startPromise = this._start(headless)
    try {
      await this.startPromise
      return { cdpPort: this.cdpPort!, headless: this._headless }
    } finally {
      this.startPromise = null
    }
  }

  isRunning(): boolean {
    return this.state === 'running' && this.isAlive()
  }

  getCdpPort(): number | null {
    return this.isRunning() ? this.cdpPort : null
  }

  getState(): { state: ChromeState; headless: boolean; cdpPort: number | null } {
    return { state: this.state, headless: this._headless, cdpPort: this.cdpPort }
  }

  async shutdown(): Promise<void> {
    logger.info('browser', 'Shutting down Chrome')
    this.stopHealthCheck()

    if (this.proc) {
      try {
        this.proc.kill()
        // Wait up to 3s for graceful exit
        const timeout = setTimeout(() => {
          try {
            this.proc?.kill(9)
          } catch {
            /* already dead */
          }
        }, 3000)
        try {
          await this.proc.exited
        } catch {
          /* ignore */
        }
        clearTimeout(timeout)
      } catch {
        /* ignore */
      }
      this.proc = null
    }

    this.cdpPort = null
    this.state = 'idle'
  }

  // --- Internal ---

  private async _start(headless: boolean): Promise<void> {
    this.state = 'starting'
    this._headless = headless

    logger.info('browser', 'Starting Chrome', { headless })

    try {
      if (!this.chromePath) {
        this.chromePath = findChromePath()
        if (!this.chromePath) {
          throw new Error(
            'Chrome not found. Please install Google Chrome. Searched common paths for ' +
              platform(),
          )
        }
      }
      logger.info('browser', 'Chrome binary found', { path: this.chromePath })

      if (!existsSync(PROFILE_DIR)) {
        mkdirSync(PROFILE_DIR, { recursive: true })
      }

      this.cdpPort = await getAvailablePort()
      logger.info('browser', 'CDP port allocated', { cdpPort: this.cdpPort })

      await this.launch()
      await this.waitForCdpReady()

      this.state = 'running'
      this.startHealthCheck()
      logger.info('browser', 'Chrome started successfully', {
        cdpPort: this.cdpPort,
        headless: this._headless,
      })
    } catch (err) {
      this.state = 'error'
      logger.error('browser', 'Failed to start Chrome', { error: String(err) })
      if (this.proc) {
        try {
          this.proc.kill(9)
        } catch {
          /* ignore */
        }
        this.proc = null
      }
      throw err
    }
  }

  private async launch(): Promise<void> {
    const args = [
      `--remote-debugging-port=${this.cdpPort}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-features=ChromeWhatsNewUI,MediaRouter,AutoUpdate',
      '--no-service-autorun',
      '--disable-sync',
      '--disable-translate',
      '--simulate-outdated-no-au',
      '--no-pings',
      '--disable-domain-reliability',
    ]

    if (this._headless) {
      args.push('--headless=new')
      args.push('--window-size=1920,1080')
    }

    args.push('about:blank')

    this.proc = Bun.spawn([this.chromePath!, ...args], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })

    // Monitor exit
    this.proc.exited.then((code) => {
      logger.info('browser', 'Chrome process exited', { code })
      if (this.state === 'running') {
        this.state = 'idle'
        this.cdpPort = null
        this.stopHealthCheck()
      }
    })
  }

  private async waitForCdpReady(): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < CDP_READY_TIMEOUT) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.cdpPort}/json/version`, {
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) {
          logger.info('browser', 'CDP endpoint ready')
          return
        }
      } catch {
        /* not ready */
      }
      await sleep(CDP_PROBE_INTERVAL)
    }
    throw new Error(`Chrome CDP not ready after ${CDP_READY_TIMEOUT}ms`)
  }

  private isAlive(): boolean {
    if (!this.proc) return false
    // Bun.spawn process: check if exitCode is null (still running)
    try {
      return this.proc.exitCode === null
    } catch {
      return false
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck()
    this.healthTimer = setInterval(() => {
      if (!this.isAlive()) {
        logger.warn('browser', 'Chrome process died unexpectedly')
        this.state = 'idle'
        this.cdpPort = null
        this.proc = null
        this.stopHealthCheck()
      }
    }, HEALTH_CHECK_INTERVAL)
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }
}

/** Singleton */
export const chromeManager = new ChromeManager()
