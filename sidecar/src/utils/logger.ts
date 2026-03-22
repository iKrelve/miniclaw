/**
 * Logger — file-based logging to ~/.miniclaw/logs/sidecar.log
 *
 * Also mirrors to stderr (stdout reserved for Tauri READY protocol).
 * Format: [ISO] [LEVEL] [module] message {json}
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const LOG_DIR = path.join(process.env.MINICLAW_DATA_DIR || path.join(os.homedir(), '.miniclaw'), 'logs')
const LOG_FILE = path.join(LOG_DIR, 'sidecar.log')

// Max log file size before rotation (5MB)
const MAX_SIZE = 5 * 1024 * 1024

let fd: number | null = null

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

function rotate() {
  try {
    const stat = fs.statSync(LOG_FILE)
    if (stat.size > MAX_SIZE) {
      const rotated = LOG_FILE + '.1'
      // Keep only one rotated file
      if (fs.existsSync(rotated)) fs.unlinkSync(rotated)
      fs.renameSync(LOG_FILE, rotated)
      // Reopen fd
      if (fd !== null) { try { fs.closeSync(fd) } catch {} }
      fd = null
    }
  } catch {
    // File may not exist yet
  }
}

function getFd(): number {
  if (fd !== null) return fd
  ensureDir()
  rotate()
  fd = fs.openSync(LOG_FILE, 'a')
  return fd
}

type Level = 'debug' | 'info' | 'warn' | 'error'

function write(level: Level, mod: string, msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  const suffix = data ? ' ' + JSON.stringify(data) : ''
  const line = `[${ts}] [${level.toUpperCase()}] [${mod}] ${msg}${suffix}\n`

  // Write to file
  try {
    fs.writeSync(getFd(), line)
  } catch {
    // If write fails (e.g. fd became invalid), reset and retry once
    fd = null
    try { fs.writeSync(getFd(), line) } catch { /* give up */ }
  }

  // Also mirror to stderr for dev console visibility
  process.stderr.write(line)
}

export const logger = {
  debug: (mod: string, msg: string, data?: Record<string, unknown>) => write('debug', mod, msg, data),
  info: (mod: string, msg: string, data?: Record<string, unknown>) => write('info', mod, msg, data),
  warn: (mod: string, msg: string, data?: Record<string, unknown>) => write('warn', mod, msg, data),
  error: (mod: string, msg: string, data?: Record<string, unknown>) => write('error', mod, msg, data),

  /** Log path for external tools to read */
  logPath: LOG_FILE,
}
