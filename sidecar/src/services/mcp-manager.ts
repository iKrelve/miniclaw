/**
 * MCP Manager — Loads and merges MCP server configurations.
 * Simplified from CodePilot's loadMcpServers in route.ts.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { getSetting } from '../db'
import type { McpServerConfig } from '../../../shared/types'

/**
 * Load MCP server configs from standard locations:
 * 1. ~/.claude.json (mcpServers)
 * 2. ~/.claude/settings.json (mcpServers)
 * 3. Project .mcp.json (mcpServers)
 *
 * Project-level takes precedence over user-level, which takes precedence over global.
 */
export function loadMcpServers(projectDir?: string): Record<string, McpServerConfig> | undefined {
  try {
    const readJson = (p: string): Record<string, unknown> => {
      if (!fs.existsSync(p)) return {}
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'))
      } catch {
        return {}
      }
    }

    const home = os.homedir()
    const globalConfig = readJson(path.join(home, '.claude.json'))
    const userSettings = readJson(path.join(home, '.claude', 'settings.json'))

    // Project-level MCP config
    const cwd = projectDir || process.cwd()
    const projectMcp = readJson(path.join(cwd, '.mcp.json'))

    // Merge: global < user < project
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

    return Object.keys(merged).length > 0 ? merged : undefined
  } catch {
    return undefined
  }
}

/** Get status of loaded MCP servers (placeholder — real status tracking requires runtime) */
export function getMcpStatus(): Array<{ name: string; status: string }> {
  const configs = loadMcpServers()
  if (!configs) return []
  return Object.keys(configs).map((name) => ({
    name,
    status: 'configured', // Actual connection status requires runtime tracking
  }))
}
