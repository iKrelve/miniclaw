/**
 * Logger — pino-based logging to ~/.miniclaw/logs/sidecar.log
 *
 * Uses pino (high-perf JSON logger) + pino-roll (size-based file rotation).
 * Also mirrors to stderr (stdout reserved for Tauri READY protocol).
 *
 * Public API kept as `logger.info(mod, msg, data?)` so call sites are unchanged.
 */

import pino from 'pino'
import path from 'path'
import fs from 'fs'
import os from 'os'

const LOG_DIR = path.join(process.env.MINICLAW_DATA_DIR || path.join(os.homedir(), '.miniclaw'), 'logs')
const LOG_FILE = path.join(LOG_DIR, 'sidecar.log')

// Ensure log directory exists before pino-roll tries to open the file
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

// Create pino instance with two targets:
//   1. pino-roll → file with size-based rotation (5MB, keep 3 rotated files)
//   2. stderr → dev console (pino-pretty style via pino/file transport)
const pinoInstance = pino(
  {
    level: 'debug',
    // Flatten timestamp to ISO string at top level for readability
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
 * Wrapper that preserves our `logger.info(mod, msg, data?)` call convention
 * while delegating to pino's structured logging underneath.
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

  /** Log path for external tools to read */
  logPath: LOG_FILE,

  /** Underlying pino instance (for advanced use) */
  pino: pinoInstance,
}
