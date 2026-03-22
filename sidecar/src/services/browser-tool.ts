/**
 * Browser Bridge — per-session agent-browser daemon management.
 *
 * Provides browser automation via agent-browser CLI binary. Each chat session
 * gets its own daemon process (--session flag) for isolation, while all sessions
 * share the same Chrome profile (cookie jar, login state).
 *
 * Architecture:
 *   miniclaw-desk CLI → POST /browser/action → BridgePool → agent-browser binary
 *     → per-session daemon (Unix socket) → CDP → Chrome
 *
 * No MCP server registration — Claude discovers browser commands via the
 * miniclaw-browser skill installed to ~/.claude/skills/.
 */

import { execFile, execFileSync } from 'child_process'
import { existsSync, chmodSync, statSync } from 'fs'
import { join, dirname, resolve, extname } from 'path'
import { platform, arch, homedir } from 'os'
import { chromeManager } from './chrome-manager'
import { logger } from '../utils/logger'

// ==========================================
// Screenshot resize — fit Anthropic Vision API limits
// Max 1568px on longest side. Uses platform-native tools
// (sips on macOS, ffmpeg on Linux) so no native JS addons needed.
// ==========================================

const MAX_SCREENSHOT_DIMENSION = 1568

/**
 * Resize a screenshot file in-place if it exceeds the dimension limit.
 * Converts to JPEG quality 80 for smaller file size.
 * Non-fatal: logs a warning and returns the original path on failure.
 */
async function resizeScreenshotIfNeeded(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()
  if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') return filePath

  const outPath = filePath.replace(/\.[^.]+$/, '.jpg')

  try {
    if (platform() === 'darwin') {
      // macOS: sips is built-in, fast, and reliable
      execFileSync(
        'sips',
        [
          '--resampleHeightWidthMax',
          String(MAX_SCREENSHOT_DIMENSION),
          '-s',
          'format',
          'jpeg',
          '-s',
          'formatOptions',
          '80',
          filePath,
          '--out',
          outPath,
        ],
        { timeout: 10_000, stdio: 'ignore' },
      )
    } else {
      // Linux/Windows: try ffmpeg (commonly available)
      execFileSync(
        'ffmpeg',
        [
          '-y',
          '-i',
          filePath,
          '-vf',
          `scale='min(${MAX_SCREENSHOT_DIMENSION},iw)':min'(${MAX_SCREENSHOT_DIMENSION},ih)':force_original_aspect_ratio=decrease`,
          '-q:v',
          '2',
          outPath,
        ],
        { timeout: 10_000, stdio: 'ignore' },
      )
    }

    const stat = statSync(outPath)
    logger.info('browser', 'Screenshot resized', {
      original: filePath,
      output: outPath,
      sizeKB: Math.round(stat.size / 1024),
    })
    return outPath
  } catch (err) {
    logger.warn('browser', 'Screenshot resize failed, using original', {
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
    })
    return filePath
  }
}

// ==========================================
// agent-browser CLI binary resolution
// ==========================================

const CLI_TIMEOUT = 30_000
const CLI_TIMEOUT_HEAVY = 60_000
const MAX_BUFFER = 10 * 1024 * 1024

export interface CliResult {
  success: boolean
  data?: unknown
  error?: string
}

let cachedBinary: string | null = null

/**
 * Resolve agent-browser binary path.
 * Searches multiple candidate node_modules locations.
 */
function resolveBinary(): string {
  if (cachedBinary) return cachedBinary

  const os = platform()
  const cpu = arch()
  const osKey =
    os === 'darwin' ? 'darwin' : os === 'linux' ? 'linux' : os === 'win32' ? 'win32' : ''
  const archKey = cpu === 'arm64' || cpu === 'aarch64' ? 'arm64' : 'x64'

  if (!osKey) throw new Error(`Unsupported platform: ${os}`)

  const ext = os === 'win32' ? '.exe' : ''
  const name = `agent-browser-${osKey}-${archKey}${ext}`

  const candidates: string[] = []

  // Relative to this file's source location
  const thisDir = dirname(new URL(import.meta.url).pathname)
  candidates.push(resolve(thisDir, '../../node_modules/agent-browser/bin', name))
  candidates.push(resolve(thisDir, '../../../node_modules/agent-browser/bin', name))

  // Relative to cwd
  candidates.push(resolve(process.cwd(), 'node_modules/agent-browser/bin', name))
  candidates.push(resolve(process.cwd(), 'sidecar/node_modules/agent-browser/bin', name))

  if (typeof __dirname !== 'undefined') {
    candidates.push(resolve(__dirname, '../../node_modules/agent-browser/bin', name))
    candidates.push(resolve(__dirname, '../../../node_modules/agent-browser/bin', name))
  }

  // Global install fallback
  candidates.push(join(homedir(), '.miniclaw', 'node_modules', 'agent-browser', 'bin', name))

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      if (os !== 'win32') {
        try {
          chmodSync(candidate, 0o755)
        } catch {
          /* ignore */
        }
      }
      cachedBinary = candidate
      logger.info('browser', 'agent-browser binary resolved', { path: candidate })
      return candidate
    }
  }

  logger.error('browser', 'agent-browser binary not found', { candidates, cwd: process.cwd() })
  throw new Error(
    `agent-browser binary not found. Run: cd sidecar && bun install\nSearched: ${candidates.join(', ')}`,
  )
}

/** Check if the agent-browser binary is available */
export function isAgentBrowserAvailable(): boolean {
  try {
    resolveBinary()
    return true
  } catch {
    return false
  }
}

function runCli(binary: string, args: string[], timeout = CLI_TIMEOUT): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      if (err) {
        if (stdout.trim()) {
          try {
            resolve(JSON.parse(stdout.trim()) as CliResult)
            return
          } catch {
            /* fall through */
          }
        }
        reject(new Error(`agent-browser CLI failed: ${err.message}\nstderr: ${stderr}`))
        return
      }
      const out = stdout.trim()
      if (!out) {
        resolve({ success: true })
        return
      }
      try {
        resolve(JSON.parse(out) as CliResult)
      } catch {
        resolve({ success: true, data: out })
      }
    })
  })
}

// ==========================================
// Per-session bridge with mutex
// ==========================================

class Mutex {
  private queue: Array<() => void> = []
  private locked = false

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.locked) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    } else {
      this.locked = true
    }
    try {
      return await fn()
    } finally {
      if (this.queue.length > 0) {
        this.queue.shift()!()
      } else {
        this.locked = false
      }
    }
  }
}

class SessionBridge {
  private binary: string
  private session: string
  private connected = false
  readonly mutex = new Mutex()

  constructor(sessionId: string, binary: string) {
    this.session = `miniclaw-${sessionId}`
    this.binary = binary
  }

  async connect(cdpPort: number): Promise<void> {
    if (this.connected) return
    const result = await runCli(this.binary, [
      '--session',
      this.session,
      '--json',
      '--cdp',
      String(cdpPort),
      'connect',
      String(cdpPort),
    ])
    if (!result.success) {
      throw new Error(`Failed to connect daemon: ${result.error}`)
    }
    this.connected = true
    logger.info('browser', 'SessionBridge connected', { session: this.session })
  }

  async exec(command: string, ...args: string[]): Promise<CliResult> {
    const heavy = command === 'screenshot' || command === 'pdf'
    return runCli(
      this.binary,
      ['--session', this.session, '--json', command, ...args],
      heavy ? CLI_TIMEOUT_HEAVY : CLI_TIMEOUT,
    )
  }

  async close(): Promise<void> {
    if (!this.connected) return
    try {
      await runCli(this.binary, ['--session', this.session, '--json', 'close'])
    } catch {
      /* ignore */
    }
    this.connected = false
    logger.info('browser', 'SessionBridge closed', { session: this.session })
  }
}

// ==========================================
// Bridge Pool (LRU, max 5)
// ==========================================

const MAX_BRIDGES = 5

class BridgePool {
  private bridges = new Map<string, SessionBridge>()
  private lru: string[] = []

  get(sessionId: string): SessionBridge {
    let bridge = this.bridges.get(sessionId)
    if (bridge) {
      this.lru = this.lru.filter((id) => id !== sessionId)
      this.lru.push(sessionId)
      return bridge
    }

    if (this.bridges.size >= MAX_BRIDGES) {
      const evict = this.lru.shift()
      if (evict) {
        const old = this.bridges.get(evict)
        this.bridges.delete(evict)
        old?.close().catch(() => {})
        logger.info('browser', 'Pool: evicted bridge', { sessionId: evict })
      }
    }

    bridge = new SessionBridge(sessionId, resolveBinary())
    this.bridges.set(sessionId, bridge)
    this.lru.push(sessionId)
    logger.info('browser', 'Pool: created bridge', { sessionId, size: this.bridges.size })
    return bridge
  }

  async shutdownAll(): Promise<void> {
    const closings = [...this.bridges.values()].map((b) => b.close().catch(() => {}))
    await Promise.allSettled(closings)
    this.bridges.clear()
    this.lru = []
    killOrphanedDaemons()
  }
}

function killOrphanedDaemons(): void {
  const os = platform()
  if (os === 'win32') return
  const osKey = os === 'darwin' ? 'darwin' : 'linux'
  const archKey = arch() === 'arm64' ? 'arm64' : 'x64'
  const pattern = `agent-browser-${osKey}-${archKey}`
  try {
    const { execSync } = require('child_process')
    execSync(`pkill -f "${pattern}" 2>/dev/null || true`, { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
}

const pool = new BridgePool()

/** Shutdown all bridges — call on app exit */
export async function shutdownBrowserBridges(): Promise<void> {
  await pool.shutdownAll()
}

// ==========================================
// Public API — execute browser action
// ==========================================

export interface BrowserActionCommand {
  action: string
  args?: string[]
  sessionId?: string
}

/**
 * Execute a browser action via agent-browser CLI.
 * Used by the /browser/action HTTP route (called from miniclaw-desk CLI).
 */
export async function executeBrowserAction(cmd: BrowserActionCommand): Promise<CliResult> {
  let port = chromeManager.getCdpPort()
  if (!port) {
    // Auto-start Chrome in headed mode when not running
    logger.info('browser', 'Chrome not running, auto-starting in headed mode')
    try {
      const info = await chromeManager.ensureRunning(false)
      port = info.cdpPort
    } catch (err) {
      return {
        success: false,
        error: `Failed to auto-start browser: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  const sessionId = cmd.sessionId || '__default__'
  const bridge = pool.get(sessionId)

  return bridge.mutex.run(async () => {
    await bridge.connect(port)
    const result = await bridge.exec(cmd.action, ...(cmd.args || []))

    // Post-process screenshots: resize to fit Anthropic Vision API limits,
    // then replace the file path with a short summary. If we leave { path: "..." }
    // in the output, the SDK's Read tool tries to read the binary JPEG file,
    // which floods the context and causes "Input is too long" errors.
    if (cmd.action === 'screenshot' && result.success && result.data) {
      const data = result.data as Record<string, unknown>
      if (typeof data.path === 'string') {
        const resized = await resizeScreenshotIfNeeded(data.path)
        try {
          const stat = statSync(resized)
          // Replace structured data with a text summary so SDK doesn't try to Read the file
          result.data = `Screenshot saved: ${resized} (${Math.round(stat.size / 1024)}KB)`
        } catch {
          result.data = `Screenshot saved: ${resized}`
        }
      }
    }

    return result
  })
}
