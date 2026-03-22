/**
 * Logger — pino-based structured logging to ~/.miniclaw/logs/
 *
 * Uses pino.multistream() + pino.destination() (synchronous, in-process)
 * instead of pino.transport() (worker threads). pino.transport() dynamically
 * requires target modules at runtime, which breaks inside a compiled
 * single-binary from `bun build --compile` (node_modules doesn't exist).
 *
 * Output:
 *   1. File → ~/.miniclaw/logs/sidecar.log (async flush, with size-based rotation)
 *   2. stderr → dev console (stdout reserved for Tauri READY protocol)
 *
 * Public API: `logger.info(mod, msg, data?)` — unchanged from call sites.
 */

import pino from 'pino'
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

// In-process multistream: file (async flush) + stderr (sync).
// No worker threads, compatible with bun build --compile.
const fileDest = pino.destination({ dest: LOG_FILE, sync: false, mkdir: true })
const stderrDest = pino.destination({ dest: 2, sync: true })

const pinoInstance = pino(
  {
    level: 'debug',
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    { level: 'debug', stream: fileDest },
    { level: 'debug', stream: stderrDest },
  ]),
)

// Periodic rotation check (every 60s)
setInterval(() => {
  rotate()
  // Reopen file descriptor after rotation so new logs go to the fresh file
  fileDest.reopen()
}, 60_000).unref()

/**
 * Wrapper preserving `logger.info(mod, msg, data?)` convention.
 */
function log(level: pino.Level, mod: string, msg: string, data?: Record<string, unknown>) {
  if (data) {
    pinoInstance[level]({ mod, ...data }, msg)
  } else {
    pinoInstance[level]({ mod }, msg)
  }
}

export const logger = {
  debug: (mod: string, msg: string, data?: Record<string, unknown>) => log('debug', mod, msg, data),
  info: (mod: string, msg: string, data?: Record<string, unknown>) => log('info', mod, msg, data),
  warn: (mod: string, msg: string, data?: Record<string, unknown>) => log('warn', mod, msg, data),
  error: (mod: string, msg: string, data?: Record<string, unknown>) => log('error', mod, msg, data),

  /** Log directory path */
  logDir: LOG_DIR,

  /** Underlying pino instance (for advanced use) */
  pino: pinoInstance,
}
