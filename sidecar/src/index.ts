/**
 * 小龙虾 (MiniClaw) — Sidecar Entry Point
 *
 * Bun-powered Hono HTTP server. Communicates with the Tauri shell
 * via stdout "READY:{port}" protocol, then serves API requests
 * for the React frontend.
 */

// ==========================================
// Local env overrides (.env.local — not committed, covered by *.local in .gitignore)
// ==========================================
// Looks for .env.local in two locations (first match wins):
//   1. Project root (dev mode)
//   2. ~/.miniclaw/.env.local (production / packaged app)
//
// If .env.local contains PROXY_CLI_COMMAND, the sidecar will
// auto-refresh ANTHROPIC_* credentials by running that CLI with a wrapper trick.
// This way the code has zero hardcoded tool names or URLs.
import fs from 'fs'
import pathMod from 'path'
import os from 'os'

function loadEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {}
  if (!fs.existsSync(filePath)) return vars
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return vars
}

function writeEnvFile(filePath: string, vars: Record<string, string>): void {
  const lines = ['# Auto-generated — DO NOT commit']
  for (const [k, v] of Object.entries(vars)) {
    if (v) lines.push(`${k}=${v}`)
  }
  const dir = pathMod.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, lines.join('\n') + '\n')
}

function findCliCommand(name: string): string | undefined {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const result = Bun.spawnSync([cmd, name], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 3_000,
    })
    if (!result.success) return undefined
    return result.stdout.toString().trim().split('\n')[0]?.trim() || undefined
  } catch {
    return undefined
  }
}

function refreshProxyCredentials(envPath: string, cliCommand: string): void {
  const cliBin = findCliCommand(cliCommand)
  if (!cliBin) return

  // Verify the CLI supports --code
  try {
    const helpResult = Bun.spawnSync([cliBin, '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 5_000,
    })
    if (!helpResult.success || !helpResult.stdout.toString().includes('--code')) return
  } catch {
    return
  }

  // Create a temp "claude" wrapper that captures ANTHROPIC_* env vars
  const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'proxy-env-'))
  const captureFile = pathMod.join(tmpDir, 'env.txt')
  try {
    const wrapper = pathMod.join(tmpDir, 'claude')
    fs.writeFileSync(wrapper, `#!/bin/sh\nenv | grep "^ANTHROPIC" > "${captureFile}"\nexit 0\n`)
    fs.chmodSync(wrapper, 0o755)

    const env = { ...process.env, PATH: `${tmpDir}${pathMod.delimiter}${process.env.PATH || ''}` }
    // Run from home directory so the proxy CLI captures a valid X-Working-Dir
    const cwd = os.homedir()
    try {
      Bun.spawnSync([cliBin, '--code', '--print', 'hi'], {
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 20_000,
        env: env as Record<string, string>,
        cwd,
      })
    } catch {
      /* ok */
    }

    if (!fs.existsSync(captureFile)) return
    const captured: Record<string, string> = {}
    for (const line of fs.readFileSync(captureFile, 'utf-8').split('\n')) {
      const eq = line.indexOf('=')
      if (eq < 1) continue
      captured[line.slice(0, eq)] = line.slice(eq + 1).trim()
    }
    if (!captured.ANTHROPIC_BASE_URL || !captured.ANTHROPIC_AUTH_TOKEN) return

    // Preserve PROXY_CLI_COMMAND in .env.local so it survives rewrite
    const updated: Record<string, string> = { PROXY_CLI_COMMAND: cliCommand, ...captured }
    writeEnvFile(envPath, updated)
    console.error('[sidecar] Auto-refreshed proxy credentials')
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

// Resolve .env.local path: project root (dev) or ~/.miniclaw/ (production)
const projectRoot = pathMod.resolve(import.meta.dir, '../..')
const envLocalCandidates = [
  pathMod.join(projectRoot, '.env.local'),
  pathMod.join(os.homedir(), '.miniclaw', '.env.local'),
]
const envLocalPath = envLocalCandidates.find((p) => fs.existsSync(p)) || envLocalCandidates[0]

// Load existing .env.local to check for PROXY_CLI_COMMAND
const existingVars = loadEnvFile(envLocalPath)
if (existingVars.PROXY_CLI_COMMAND) {
  try {
    refreshProxyCredentials(envLocalPath, existingVars.PROXY_CLI_COMMAND)
  } catch {
    /* non-fatal */
  }
}

// Load (possibly refreshed) .env.local into process.env
const loadedVars = loadEnvFile(envLocalPath)
for (const [key, value] of Object.entries(loadedVars)) {
  if (key === 'PROXY_CLI_COMMAND') continue // meta key, not an env var
  if (!process.env[key]) process.env[key] = value
}

// Log loaded env (after imports so logger module is initialized)
logger.info('startup', 'Loaded .env.local', {
  path: envLocalPath,
  keys: Object.keys(loadedVars).filter((k) => k !== 'PROXY_CLI_COMMAND'),
  hasBaseUrl: !!loadedVars.ANTHROPIC_BASE_URL,
  hasAuthToken: !!loadedVars.ANTHROPIC_AUTH_TOKEN,
  hasCustomHeaders: !!loadedVars.ANTHROPIC_CUSTOM_HEADERS,
})

// Auto-register mc proxy as a DB provider so it appears as its own group
// in the model selector (instead of hiding inside the "Claude Code" env group).
if (
  loadedVars.PROXY_CLI_COMMAND &&
  loadedVars.ANTHROPIC_BASE_URL &&
  loadedVars.ANTHROPIC_AUTH_TOKEN
) {
  try {
    const { upsertProvider, activateProvider } = await import('./db')
    const id = upsertProvider({
      name: 'MCopilot',
      type: 'anthropic',
      api_key: loadedVars.ANTHROPIC_AUTH_TOKEN,
      base_url: loadedVars.ANTHROPIC_BASE_URL,
    })
    activateProvider(id)
    logger.info('startup', 'Auto-registered MCopilot provider', { id })
  } catch (err) {
    logger.warn('startup', 'Failed to auto-register MCopilot provider', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Auto-register AWS Bedrock provider if AWS credentials are available.
// This scans available Claude models via ListFoundationModels API.
try {
  const { autoRegisterBedrock } = await import('./services/bedrock-scanner')
  await autoRegisterBedrock()
} catch (err) {
  logger.warn('startup', 'Failed to auto-register Bedrock provider', {
    error: err instanceof Error ? err.message : String(err),
  })
}

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getAvailablePort } from './utils/port'
import { logger } from './utils/logger'
import chatRoutes from './routes/chat'
import sessionRoutes from './routes/sessions'
import fileRoutes from './routes/files'
import gitRoutes from './routes/git'
import settingsRoutes from './routes/settings'
import providerRoutes from './routes/providers'
import mcpRoutes from './routes/mcp'
import skillsRoutes from './routes/skills'
import taskRoutes from './routes/tasks'
import workspaceRoutes from './routes/workspace'
import terminalRoutes from './routes/terminal'
import uploadRoutes from './routes/uploads'
import {
  attachSocket,
  detachSocket,
  writeToTerminal,
  resizeTerminal,
  getTerminalSession,
} from './services/terminal'

const app = new Hono()

// Enable CORS for the Tauri webview origin
app.use('*', cors({ origin: '*' }))

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', uptime: process.uptime() })
})

// Mount routes
app.route('/chat', chatRoutes)
app.route('/sessions', sessionRoutes)
app.route('/files', fileRoutes)
app.route('/git', gitRoutes)
app.route('/settings', settingsRoutes)
app.route('/providers', providerRoutes)
app.route('/mcp', mcpRoutes)
app.route('/skills', skillsRoutes)
app.route('/tasks', taskRoutes)
app.route('/workspace', workspaceRoutes)
app.route('/terminal', terminalRoutes)
app.route('/uploads', uploadRoutes)

async function main() {
  const port = await getAvailablePort()

  logger.info('startup', 'Sidecar starting', { port, pid: process.pid })

  // Signal to Tauri that the server is ready with the port number
  // This MUST be on stdout — Tauri's sidecar manager parses it
  console.log(`READY:${port}`)

  Bun.serve<{ terminalId: string }>({
    fetch(req, server) {
      // Handle WebSocket upgrade for terminal I/O
      const url = new URL(req.url)
      const wsMatch = url.pathname.match(/^\/terminal\/([^/]+)\/ws$/)
      if (wsMatch && req.headers.get('upgrade') === 'websocket') {
        const terminalId = wsMatch[1]
        if (!getTerminalSession(terminalId)) {
          return new Response('Terminal session not found', { status: 404 })
        }
        const upgraded = server.upgrade(req, { data: { terminalId } })
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 500 })
        }
        return undefined
      }
      // All other requests go through Hono
      return app.fetch(req, server)
    },
    websocket: {
      open(ws) {
        const { terminalId } = ws.data as { terminalId: string }
        attachSocket(terminalId, ws)
      },
      message(ws, message) {
        const { terminalId } = ws.data as { terminalId: string }
        const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
        // Handle resize messages: JSON with { type: "resize", cols, rows }
        if (data.startsWith('{"type":"resize"')) {
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
              resizeTerminal(terminalId, parsed.cols, parsed.rows)
              return
            }
          } catch {
            /* not JSON, treat as regular input */
          }
        }
        // Forward user input to the PTY process
        writeToTerminal(terminalId, data)
      },
      close(ws) {
        const { terminalId } = ws.data as { terminalId: string }
        detachSocket(terminalId, ws)
      },
    },
    port,
    hostname: '127.0.0.1',
  })

  logger.info('startup', `小龙虾 server running on http://127.0.0.1:${port}`)
  // Also print to stderr for dev console
  console.error(`[sidecar] 小龙虾 server running on http://127.0.0.1:${port}`)
}

main().catch((err) => {
  console.error('[sidecar] Fatal error:', err)
  process.exit(1)
})
