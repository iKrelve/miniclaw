/**
 * MCP HTTP routes — full CRUD for MCP server configuration.
 *
 * Config sources (read):
 * - ~/.claude.json (mcpServers)
 * - ~/.claude/settings.json (mcpServers)
 * - Project .mcp.json (mcpServers)
 *
 * Config writes go to ~/.claude/settings.json (user-level).
 */

import { Hono } from 'hono'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { McpServerConfig, McpStatus } from '../../../shared/types'
import { getSetting } from '../db'

const mcpRoutes = new Hono()

// ==========================================
// Config File Helpers
// ==========================================

function readJson(p: string): Record<string, unknown> {
  if (!fs.existsSync(p)) return {}
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function getUserSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

function getUserSettings(): Record<string, unknown> {
  return readJson(getUserSettingsPath())
}

function writeUserSettings(settings: Record<string, unknown>): void {
  const dir = path.dirname(getUserSettingsPath())
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(getUserSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

function getUserMcpServers(): Record<string, McpServerConfig> {
  const settings = getUserSettings()
  return (settings.mcpServers || {}) as Record<string, McpServerConfig>
}

function setUserMcpServers(servers: Record<string, McpServerConfig>): void {
  const settings = getUserSettings()
  settings.mcpServers = servers
  writeUserSettings(settings)
}

/**
 * Load and merge MCP servers from all sources.
 * Project-level takes precedence over user-level, which takes precedence over global.
 */
function loadMergedServers(projectDir?: string): Record<string, McpServerConfig> {
  const globalConfig = readJson(path.join(os.homedir(), '.claude.json'))
  const userSettings = readJson(getUserSettingsPath())
  const cwd = projectDir || process.cwd()
  const projectMcp = readJson(path.join(cwd, '.mcp.json'))

  const merged: Record<string, McpServerConfig> = {
    ...((globalConfig.mcpServers || {}) as Record<string, McpServerConfig>),
    ...((userSettings.mcpServers || {}) as Record<string, McpServerConfig>),
    ...((projectMcp.mcpServers || {}) as Record<string, McpServerConfig>),
  }

  // Resolve ${...} placeholders in env values against DB settings
  for (const server of Object.values(merged)) {
    if (server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
          const settingKey = value.slice(2, -1)
          const resolved = getSetting(settingKey)
          server.env[key] = resolved || ''
        }
      }
    }
  }

  return merged
}

// Track which source each server comes from
interface ServerWithSource {
  config: McpServerConfig
  source: 'global' | 'user' | 'project'
}

function loadServersWithSource(projectDir?: string): Record<string, ServerWithSource> {
  const globalConfig = readJson(path.join(os.homedir(), '.claude.json'))
  const userSettings = readJson(getUserSettingsPath())
  const cwd = projectDir || process.cwd()
  const projectMcp = readJson(path.join(cwd, '.mcp.json'))

  const result: Record<string, ServerWithSource> = {}

  const globalServers = (globalConfig.mcpServers || {}) as Record<string, McpServerConfig>
  for (const [name, config] of Object.entries(globalServers)) {
    result[name] = { config, source: 'global' }
  }

  const userServers = (userSettings.mcpServers || {}) as Record<string, McpServerConfig>
  for (const [name, config] of Object.entries(userServers)) {
    result[name] = { config, source: 'user' }
  }

  const projectServers = (projectMcp.mcpServers || {}) as Record<string, McpServerConfig>
  for (const [name, config] of Object.entries(projectServers)) {
    result[name] = { config, source: 'project' }
  }

  return result
}

// ==========================================
// Routes
// ==========================================

/** GET /mcp — List all MCP servers with merged config */
mcpRoutes.get('/', (c) => {
  const cwd = c.req.query('cwd') || undefined
  const serversWithSource = loadServersWithSource(cwd)

  const servers = Object.entries(serversWithSource).map(([name, { config, source }]) => ({
    name,
    config,
    source,
    status: (config.enabled === false ? 'disabled' : 'configured') as McpStatus,
  }))

  return c.json({ servers })
})

/** GET /mcp/status — Get connection status */
mcpRoutes.get('/status', (c) => {
  const cwd = c.req.query('cwd') || undefined
  const merged = loadMergedServers(cwd)
  const servers = Object.entries(merged).map(([name, config]) => ({
    name,
    status: config.enabled === false ? 'disabled' : 'configured',
  }))
  return c.json({ servers })
})

/** GET /mcp/config — Get raw JSON config for editor */
mcpRoutes.get('/config', (c) => {
  const cwd = c.req.query('cwd') || undefined
  const merged = loadMergedServers(cwd)
  return c.json({ mcpServers: merged })
})

/** PUT /mcp/config — Save entire JSON config */
mcpRoutes.put('/config', async (c) => {
  const body = await c.req.json()
  const { mcpServers } = body as { mcpServers: Record<string, McpServerConfig> }

  if (!mcpServers || typeof mcpServers !== 'object') {
    return c.json({ error: 'mcpServers object is required' }, 400)
  }

  setUserMcpServers(mcpServers)
  return c.json({ success: true })
})

/** POST /mcp — Add a new MCP server */
mcpRoutes.post('/', async (c) => {
  const body = await c.req.json()
  const { name, config } = body as { name: string; config: McpServerConfig }

  if (!name || typeof name !== 'string') {
    return c.json({ error: 'Server name is required' }, 400)
  }

  const servers = getUserMcpServers()
  const updated = name in servers
  servers[name] = config
  setUserMcpServers(servers)

  return c.json({ success: true, name, updated }, updated ? 200 : 201)
})

/** PUT /mcp/:name — Update an existing MCP server */
mcpRoutes.put('/:name', async (c) => {
  const name = c.req.param('name')
  const body = await c.req.json()
  const { config } = body as { config: McpServerConfig }

  const servers = getUserMcpServers()
  if (!(name in servers)) {
    return c.json({ error: 'Server not found in user config' }, 404)
  }

  servers[name] = config
  setUserMcpServers(servers)
  return c.json({ success: true })
})

/** DELETE /mcp/:name — Remove an MCP server */
mcpRoutes.delete('/:name', (c) => {
  const name = c.req.param('name')

  const servers = getUserMcpServers()
  if (!(name in servers)) {
    return c.json({ error: 'Server not found in user config' }, 404)
  }

  delete servers[name]
  setUserMcpServers(servers)
  return c.json({ success: true })
})

/** PUT /mcp/:name/toggle — Enable/disable a server */
mcpRoutes.put('/:name/toggle', async (c) => {
  const name = c.req.param('name')
  const body = await c.req.json()
  const { enabled } = body as { enabled: boolean }

  const servers = getUserMcpServers()

  if (name in servers) {
    servers[name] = { ...servers[name], enabled }
  } else {
    // Server might be from global/.claude.json — create override in user settings
    const merged = loadMergedServers()
    if (!(name in merged)) {
      return c.json({ error: 'Server not found' }, 404)
    }
    servers[name] = { ...merged[name], enabled }
  }

  setUserMcpServers(servers)
  return c.json({ success: true, enabled })
})

export default mcpRoutes
