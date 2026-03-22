/**
 * Terminal Service — Bun native PTY subprocess management.
 *
 * Uses Bun.spawn({ terminal }) for real pseudo-terminal support.
 * Zero external dependencies — no node-pty, no native .node modules.
 * Fully compatible with `bun build --compile`.
 *
 * Key Bun terminal API:
 *   - proc.terminal.write(data)  — write to the PTY
 *   - proc.terminal.resize(c, r) — resize the PTY (sends SIGWINCH)
 *   - proc.terminal.close()      — close the PTY fd
 *
 * Output is streamed to connected WebSocket clients in real-time
 * via the `data` callback.
 */

import type { Subprocess, ServerWebSocket } from 'bun'
import os from 'os'
import { logger } from '../utils/logger'

interface TerminalSession {
  id: string
  proc: Subprocess
  cwd: string
  /** Connected WebSocket clients receiving PTY output */
  sockets: Set<ServerWebSocket<{ terminalId: string }>>
}

const sessions = new Map<string, TerminalSession>()

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/zsh'
}

export function createTerminalSession(
  id: string,
  cwd?: string,
  cols?: number,
  rows?: number,
): TerminalSession {
  const workDir = cwd || os.homedir()
  const shell = getDefaultShell()
  const c = cols || 80
  const r = rows || 24

  // Pre-create the session so the `data` callback can reference it
  const session: TerminalSession = {
    id,
    proc: null as unknown as Subprocess,
    cwd: workDir,
    sockets: new Set(),
  }

  const proc = Bun.spawn([shell], {
    cwd: workDir,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    terminal: {
      cols: c,
      rows: r,
      // Called when data is received from the PTY
      data(_terminal, data) {
        for (const ws of session.sockets) {
          try {
            ws.send(data)
          } catch {
            /* socket may have closed */
          }
        }
      },
    },
    onExit(_proc, exitCode, signalCode) {
      logger.info('terminal', 'PTY process exited', { id, exitCode, signal: signalCode })
      for (const ws of session.sockets) {
        try {
          ws.close(1000, 'Terminal process exited')
        } catch {
          /* ignore */
        }
      }
      session.sockets.clear()
      sessions.delete(id)
    },
  })

  session.proc = proc
  sessions.set(id, session)

  logger.info('terminal', 'PTY session created', {
    id,
    shell,
    cwd: workDir,
    cols: c,
    rows: r,
    pid: proc.pid,
  })
  return session
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id)
}

export function attachSocket(id: string, ws: ServerWebSocket<{ terminalId: string }>): boolean {
  const session = sessions.get(id)
  if (!session) return false
  session.sockets.add(ws)
  return true
}

export function detachSocket(id: string, ws: ServerWebSocket<{ terminalId: string }>): void {
  const session = sessions.get(id)
  if (session) {
    session.sockets.delete(ws)
  }
}

export function writeToTerminal(id: string, data: string): boolean {
  const session = sessions.get(id)
  if (!session?.proc.terminal) return false
  session.proc.terminal.write(data)
  return true
}

/**
 * Resize the PTY. Sends SIGWINCH to the subprocess.
 */
export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id)
  if (!session?.proc.terminal) return false
  try {
    session.proc.terminal.resize(cols, rows)
    return true
  } catch {
    return false
  }
}

export function killTerminalSession(id: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  for (const ws of session.sockets) {
    try {
      ws.close(1000, 'Terminal session killed')
    } catch {
      /* ignore */
    }
  }
  session.sockets.clear()
  // Close the PTY, then kill the process
  if (session.proc.terminal) {
    session.proc.terminal.close()
  }
  session.proc.kill()
  sessions.delete(id)
  return true
}

export function killAllTerminals(): void {
  for (const [id] of sessions) {
    killTerminalSession(id)
  }
}
