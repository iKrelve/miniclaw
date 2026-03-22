/**
 * Logger — Bun-native structured logging to ~/.miniclaw/logs/
 *
 * Uses Bun.file().writer() for async file writes (no pino, no worker threads).
 * Fully compatible with `bun build --compile`.
 *
 * Output:
 *   1. File → ~/.miniclaw/logs/sidecar.log (async flush, with size-based rotation)
 *   2. stderr → dev console (stdout reserved for Tauri READY protocol)
 *
 * Format: NDJSON (one JSON object per line), same as pino for log reader compat.
 * Public API: `logger.info(mod, msg, data?)` — unchanged from call sites.
 */

import path from 'path'
import fs from 'fs'
import os from 'os'

const LOG_DIR = path.join(
  process.env.MINICLAW_DATA_DIR || path.join(os.homedir(), '.miniclaw'),
  'logs',
)
const LOG_FILE = path.join(LOG_DIR, 'sidecar.log')
const MAX_SIZE = 5 * 1024 * 1024 // 5MB per file
const MAX_ROTATED = 3

// pino-compatible numeric log levels
const LEVELS = { debug: 20, info: 30, warn: 40, error: 50 } as const
type Level = keyof typeof LEVELS

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

/**
 * Simple size-based log rotation. Runs in-process, no worker threads.
 * Shifts: sidecar.log → sidecar.log.1 → .2 → .3 (oldest deleted).
 */
function rotate() {
  try {
    if (!fs.existsSync(LOG_FILE)) return
    const stat = fs.statSync(LOG_FILE)
    if (stat.size < MAX_SIZE) return
    for (let i = MAX_ROTATED; i >= 1; i--) {
      const src = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`
      const dst = `${LOG_FILE}.${i}`
      if (i === MAX_ROTATED && fs.existsSync(dst)) fs.unlinkSync(dst)
      if (fs.existsSync(src)) fs.renameSync(src, dst)
    }
  } catch {
    /* best effort */
  }
}

// Rotate leftover large log from previous run
rotate()

// Bun-native file writer for async log output
const writer = Bun.file(LOG_FILE).writer()

/**
 * Write a single NDJSON log line to file + stderr.
 */
/** Format Date as Beijing time (UTC+8) ISO string: YYYY-MM-DDTHH:mm:ss.sss+08:00 */
function toBeijingISO(d: Date): string {
  const utc = d.getTime()
  const beijing = new Date(utc + 8 * 3600_000)
  return beijing.toISOString().replace('Z', '+08:00')
}

function emit(level: Level, mod: string, msg: string, data?: Record<string, unknown>) {
  const entry = {
    level: LEVELS[level],
    time: toBeijingISO(new Date()),
    mod,
    msg,
    ...data,
  }
  const line = JSON.stringify(entry) + '\n'

  // Async write to file (buffered, Bun flushes automatically)
  writer.write(line)

  // Sync write to stderr for dev console (stdout reserved for READY protocol)
  process.stderr.write(line)
}

// Periodic rotation check (every 60s)
setInterval(() => {
  writer.flush()
  rotate()
}, 60_000).unref()

// Flush on exit to avoid losing buffered logs
process.on('beforeExit', () => {
  writer.flush()
})

export const logger = {
  debug: (mod: string, msg: string, data?: Record<string, unknown>) =>
    emit('debug', mod, msg, data),
  info: (mod: string, msg: string, data?: Record<string, unknown>) => emit('info', mod, msg, data),
  warn: (mod: string, msg: string, data?: Record<string, unknown>) => emit('warn', mod, msg, data),
  error: (mod: string, msg: string, data?: Record<string, unknown>) =>
    emit('error', mod, msg, data),

  /** Log directory path */
  logDir: LOG_DIR,

  /** Flush buffered writes to disk */
  flush: () => writer.flush(),
}
