/**
 * Platform utilities — Claude binary detection and PATH expansion.
 * Simplified from CodePilot's src/lib/platform.ts.
 *
 * Uses Bun.spawnSync (no child_process).
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { logger } from '../utils/logger'

export const isWindows = process.platform === 'win32'
export const isMac = process.platform === 'darwin'

function getExtraPathDirs(): string[] {
  const home = os.homedir()
  if (isWindows) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    return [
      path.join(home, '.local', 'bin'),
      path.join(home, '.claude', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(appData, 'npm'),
      path.join(localAppData, 'npm'),
    ]
  }
  return [
    path.join(home, '.miniclaw', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'bin'),
    path.join(home, '.bun', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.nvm', 'current', 'bin'),
  ]
}

export function getExpandedPath(): string {
  const currentPath = process.env.PATH || ''
  const extra = getExtraPathDirs().filter((d) => !currentPath.includes(d))
  return [...extra, currentPath].join(path.delimiter)
}

let cachedClaudePath: string | null | undefined

export function findClaudeBinary(): string | undefined {
  if (cachedClaudePath !== undefined) return cachedClaudePath || undefined

  const names = isWindows ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude']
  const dirs = getExtraPathDirs()

  // Also check PATH directories
  const pathDirs = (process.env.PATH || '').split(path.delimiter)
  const allDirs = [...dirs, ...pathDirs]

  for (const dir of allDirs) {
    for (const name of names) {
      const full = path.join(dir, name)
      try {
        if (fs.existsSync(full)) {
          cachedClaudePath = full
          logger.info('platform', 'Found claude binary', { path: full })
          return full
        }
      } catch {
        // skip inaccessible dirs
      }
    }
  }

  // Try `which` / `where` as fallback
  try {
    const cmd = isWindows ? 'where' : 'which'
    const result = Bun.spawnSync([cmd, 'claude'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 5_000,
    })
    if (result.success) {
      const first = result.stdout.toString().trim().split('\n')[0]?.trim()
      if (first && fs.existsSync(first)) {
        cachedClaudePath = first
        return first
      }
    }
  } catch {
    // not found
  }

  cachedClaudePath = null
  logger.warn('platform', 'Claude binary not found in any location')
  return undefined
}
