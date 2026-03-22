/**
 * Browser Tool — registers browser_action as an SDK MCP tool via createSdkMcpServer().
 *
 * Uses agent-browser v0.20+ Rust CLI binary for browser automation.
 * Each chat session gets its own daemon process (--session flag) for isolation,
 * while all sessions share the same Chrome profile (cookie jar, login state).
 *
 * Architecture:
 *   Claude → browser_action MCP tool → BridgePool → AgentBrowserClient (execFile)
 *     → agent-browser CLI binary → per-session daemon (Unix socket) → CDP → Chrome
 *
 * Key design:
 * - Per-session daemon: each sessionId gets an independent daemon with its own
 *   active_page_index and ref_map, enabling parallel browser operations.
 * - Shared Chrome: all daemons connect to the same Chrome process via CDP port,
 *   sharing cookies/storage/profile.
 * - LRU eviction: pool caps at 5 bridges; least-recently-used are evicted.
 * - Mutex: commands within a session are serialized to prevent race conditions.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { execFile } from 'child_process'
import { existsSync, chmodSync, readFileSync } from 'fs'
import { join, dirname, extname } from 'path'
import { platform, arch } from 'os'
import { createRequire } from 'module'
import { chromeManager } from './chrome-manager'
import { logger } from '../utils/logger'

// ==========================================
// agent-browser CLI client
// ==========================================

const CLI_TIMEOUT = 30_000
const CLI_TIMEOUT_HEAVY = 60_000
const MAX_BUFFER = 10 * 1024 * 1024

interface CliResult {
  success: boolean
  data?: unknown
  error?: string
}

let cachedBinary: string | null = null

function resolveBinary(): string {
  if (cachedBinary) return cachedBinary

  const require = createRequire(import.meta.url)
  let pkgDir: string
  try {
    const pkg = require.resolve('agent-browser/package.json')
    pkgDir = dirname(pkg)
  } catch {
    throw new Error('agent-browser package not found. Run: cd sidecar && bun install')
  }

  const os = platform()
  const cpu = arch()
  const osKey =
    os === 'darwin' ? 'darwin' : os === 'linux' ? 'linux' : os === 'win32' ? 'win32' : ''
  const archKey = cpu === 'arm64' || cpu === 'aarch64' ? 'arm64' : 'x64'

  if (!osKey) throw new Error(`Unsupported platform: ${os}`)

  const ext = os === 'win32' ? '.exe' : ''
  const name = `agent-browser-${osKey}-${archKey}${ext}`
  const binary = join(pkgDir, 'bin', name)

  if (!existsSync(binary)) {
    throw new Error(`agent-browser binary not found: ${binary}`)
  }

  if (os !== 'win32') {
    try {
      chmodSync(binary, 0o755)
    } catch {
      /* ignore */
    }
  }

  cachedBinary = binary
  logger.info('browser', 'agent-browser binary resolved', { path: binary })
  return binary
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
    // acquire
    if (this.locked) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    } else {
      this.locked = true
    }
    try {
      return await fn()
    } finally {
      // release
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

  /** Connect to Chrome CDP (auto-spawns daemon) */
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

  /** Execute a CLI command (after connection established) */
  async exec(command: string, ...args: string[]): Promise<CliResult> {
    const heavy = command === 'screenshot' || command === 'pdf'
    return runCli(
      this.binary,
      ['--session', this.session, '--json', command, ...args],
      heavy ? CLI_TIMEOUT_HEAVY : CLI_TIMEOUT,
    )
  }

  /** Shutdown the daemon */
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
      // Move to end of LRU
      this.lru = this.lru.filter((id) => id !== sessionId)
      this.lru.push(sessionId)
      return bridge
    }

    // Evict if at capacity
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
  if (os === 'win32') return // Skip on Windows for now
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
// Screenshot enrichment (base64 inline)
// ==========================================

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function enrichScreenshot(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const obj = data as Record<string, unknown>
  const filePath = obj.path
  if (typeof filePath !== 'string') return data
  if (!IMAGE_EXTS.has(extname(filePath).toLowerCase())) return data
  try {
    if (!existsSync(filePath)) return data
    const buf = readFileSync(filePath)
    const ext = extname(filePath).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    obj.base64 = `data:${mime};base64,${buf.toString('base64')}`
    logger.info('browser', 'Attached screenshot base64', {
      path: filePath,
      kb: Math.round(buf.length / 1024),
    })
  } catch {
    /* ignore */
  }
  return data
}

// ==========================================
// MCP Tool Registration
// ==========================================

let server: McpSdkServerConfigWithInstance | null = null

/**
 * Get the browser MCP server config (lazy singleton).
 * Returns null if agent-browser binary resolution fails.
 */
export function getBrowserMcpServer(): McpSdkServerConfigWithInstance | null {
  if (server) return server

  try {
    // Pre-validate binary exists
    resolveBinary()

    server = createSdkMcpServer({
      name: 'miniclaw-browser',
      version: '1.0.0',
      tools: [
        tool(
          'browser_action',
          `Control a real Chrome browser via agent-browser. Each session has its own isolated daemon.

## Actions

Navigation: navigate <url>, back, forward, reload
Tabs: tab_new [url], tab_list, tab_switch <index>, tab_close [index]
Snapshot: snapshot (get accessibility tree with element refs like @e1, @e2)
Screenshot: screenshot [path] [--full]
Click/Input: click <ref_or_selector>, fill <ref_or_selector> <value>, type <ref_or_selector> <text>, press <key>
Scroll: scroll <selector> <direction> <amount>, scrollintoview <selector>
Wait: wait [timeout_ms], wait <selector> [--state visible|hidden]
Evaluate: evaluate <js_expression>
Get info: url, title, content [selector]

## Usage Pattern

1. Use "navigate" to go to a URL
2. Use "snapshot" to get the page structure with element refs (@e1, @e2...)
3. Use refs to interact: click @e3, fill @e5 "search query"
4. Use "screenshot" to see the visual result
5. Repeat as needed

## Important

- Always "snapshot" first to discover element refs before interacting
- Refs are session-scoped — they reset when you switch tabs or navigate
- The browser shares cookies/profile across all sessions (login once, use everywhere)`,
          {
            action: z
              .string()
              .describe('The browser action to execute (e.g. navigate, snapshot, click, fill)'),
            args: z
              .array(z.string())
              .optional()
              .describe('Arguments for the action (e.g. URL for navigate, selector for click)'),
          },
          async (input, extra) => {
            const port = chromeManager.getCdpPort()
            if (!port) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Browser is not running. Ask the user to enable the browser from the input toolbar.',
                  },
                ],
                isError: true,
              }
            }

            // Extract sessionId from extra context if available, otherwise use default
            const sessionId =
              ((extra as Record<string, unknown>)?.sessionId as string | undefined) || '__default__'

            const bridge = pool.get(sessionId)

            try {
              return await bridge.mutex.run(async () => {
                // Ensure connected to Chrome
                await bridge.connect(port)

                // Build CLI args from action + args
                const action = input.action
                const args = input.args || []

                logger.info('browser', 'browser_action', { sessionId, action, args })

                const result = await bridge.exec(action, ...args)

                if (!result.success) {
                  return {
                    content: [
                      {
                        type: 'text' as const,
                        text: `Browser action "${action}" failed: ${result.error || 'Unknown error'}`,
                      },
                    ],
                    isError: true,
                  }
                }

                // Enrich screenshot results with inline base64
                const enriched = enrichScreenshot(result.data)

                // Build response content
                const content: Array<
                  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
                > = []

                if (enriched && typeof enriched === 'object') {
                  const obj = enriched as Record<string, unknown>

                  // If screenshot result has base64, include as image
                  if (typeof obj.base64 === 'string' && obj.base64.startsWith('data:')) {
                    const parts = obj.base64.split(',')
                    const mime = parts[0].replace('data:', '').replace(';base64', '')
                    content.push({ type: 'image' as const, data: parts[1], mimeType: mime })
                    // Also include text summary (without base64 blob)
                    const summary = { ...obj }
                    delete summary.base64
                    if (Object.keys(summary).length > 0) {
                      content.push({
                        type: 'text' as const,
                        text: JSON.stringify(summary, null, 2),
                      })
                    }
                  } else {
                    // Regular result — stringify as text
                    const text =
                      typeof enriched === 'string' ? enriched : JSON.stringify(enriched, null, 2)
                    content.push({ type: 'text' as const, text })
                  }
                } else if (enriched !== undefined && enriched !== null) {
                  content.push({ type: 'text' as const, text: String(enriched) })
                } else {
                  content.push({
                    type: 'text' as const,
                    text: `Action "${action}" completed successfully.`,
                  })
                }

                return { content }
              })
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              logger.error('browser', 'browser_action error', {
                sessionId,
                action: input.action,
                error: msg,
              })

              // If daemon died, reset the bridge so next call reconnects
              if (
                msg.includes('ECONNREFUSED') ||
                msg.includes('ENOENT') ||
                msg.includes('daemon') ||
                msg.includes('spawn') ||
                msg.includes('killed')
              ) {
                try {
                  await bridge.close()
                } catch {
                  /* ignore */
                }
              }

              return {
                content: [{ type: 'text' as const, text: `Browser action failed: ${msg}` }],
                isError: true,
              }
            }
          },
        ),
      ],
    })

    logger.info('browser', 'Browser MCP server created (agent-browser backed)')
    return server
  } catch (err) {
    logger.error('browser', 'Failed to create browser MCP server', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
