/**
 * Logger — pino-based logging to ~/.miniclaw/logs/sidecar.log
 *
 * Uses pino (high-perf structured JSON logger) with multistream:
 *   1. File destination → ~/.miniclaw/logs/sidecar.log (sync write, reliable)
 *   2. stderr → dev console (stdout reserved for Tauri READY protocol)
 *
 * File rotation: pino-roll with size-based rotation (5MB, keep 3 rotated files).
 * Active log file gets a numeric suffix (sidecar.1.log, sidecar.2.log, etc.).
 * A `current.log` symlink always points to the latest active file.
 *
 * Public API: `logger.info(mod, msg, data?)` — unchanged from call sites.
 */

import pino from 'pino'
import path from 'path'
import fs from 'fs'
import os from 'os'

const LOG_DIR = path.join(process.env.MINICLAW_DATA_DIR || path.join(os.homedir(), '.miniclaw'), 'logs')
const LOG_FILE = path.join(LOG_DIR, 'sidecar.log')

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

// pino.transport runs worker threads — use this for file + stderr output
const pinoInstance = pino(
  {
    level: 'debug',
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.transport({
    targets: [
      {
        target: 'pino-roll',
        level: 'debug',
        options: {
          file: LOG_FILE,
          size: '5m',
          limit: { count: 3 },
          symlink: true,  // creates current.log → active log
        },
      },
      {
        target: 'pino/file',
        level: 'debug',
        options: { destination: 2 }, // fd 2 = stderr
      },
    ],
  }),
)

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

  /** Log directory — use `current.log` symlink for latest active file */
  logDir: LOG_DIR,

  /** Underlying pino instance (for advanced use) */
  pino: pinoInstance,
}
