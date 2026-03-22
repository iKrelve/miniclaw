/**
 * Terminal Service — PTY-based subprocess management.
 *
 * Uses node-pty for real pseudo-terminal support (interactive programs,
 * color output, window resize). Output is streamed to connected
 * WebSocket clients in real-time.
 */

import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { ServerWebSocket } from 'bun';
import os from 'os';
import { logger } from '../utils/logger';

interface TerminalSession {
  id: string;
  proc: IPty;
  cwd: string;
  /** Connected WebSocket clients receiving stdout */
  sockets: Set<ServerWebSocket<{ terminalId: string }>>;
}

const sessions = new Map<string, TerminalSession>();

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

export function createTerminalSession(
  id: string,
  cwd?: string,
  cols?: number,
  rows?: number,
): TerminalSession {
  const workDir = cwd || os.homedir();
  const shell = getDefaultShell();

  const proc = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: workDir,
    env: process.env as Record<string, string>,
  });

  const session: TerminalSession = { id, proc, cwd: workDir, sockets: new Set() };
  sessions.set(id, session);

  // Forward PTY output to all connected WebSocket clients
  proc.onData((data: string) => {
    for (const ws of session.sockets) {
      try { ws.send(data); } catch { /* socket may have closed */ }
    }
  });

  proc.onExit(({ exitCode, signal }) => {
    logger.info('terminal', 'PTY process exited', { id, exitCode, signal });
    // Notify connected clients that the terminal has exited
    for (const ws of session.sockets) {
      try { ws.close(1000, 'Terminal process exited'); } catch { /* ignore */ }
    }
    session.sockets.clear();
    sessions.delete(id);
  });

  logger.info('terminal', 'PTY session created', { id, shell, cwd: workDir, cols: cols || 80, rows: rows || 24 });
  return session;
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

export function attachSocket(id: string, ws: ServerWebSocket<{ terminalId: string }>): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.sockets.add(ws);
  return true;
}

export function detachSocket(id: string, ws: ServerWebSocket<{ terminalId: string }>): void {
  const session = sessions.get(id);
  if (session) {
    session.sockets.delete(ws);
  }
}

export function writeToTerminal(id: string, data: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.proc.write(data);
  return true;
}

/**
 * Resize the PTY. Called when the frontend xterm.js container changes size.
 */
export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.proc.resize(cols, rows);
    return true;
  } catch {
    return false;
  }
}

export function killTerminalSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  // Close all sockets
  for (const ws of session.sockets) {
    try { ws.close(1000, 'Terminal session killed'); } catch { /* ignore */ }
  }
  session.sockets.clear();
  session.proc.kill();
  sessions.delete(id);
  return true;
}

export function killAllTerminals(): void {
  for (const [id] of sessions) {
    killTerminalSession(id);
  }
}
