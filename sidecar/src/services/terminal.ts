/**
 * Terminal Service — subprocess management for integrated terminal.
 *
 * Uses Bun's subprocess API to spawn shells.
 * Output is streamed to connected WebSocket clients in real-time.
 */

import { spawn, type Subprocess } from 'bun';
import type { ServerWebSocket } from 'bun';
import os from 'os';

interface TerminalSession {
  id: string;
  proc: Subprocess;
  cwd: string;
  /** Connected WebSocket clients receiving stdout/stderr */
  sockets: Set<ServerWebSocket<{ terminalId: string }>>;
}

const sessions = new Map<string, TerminalSession>();

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

export function createTerminalSession(id: string, cwd?: string): TerminalSession {
  const workDir = cwd || os.homedir();
  const shell = getDefaultShell();

  const proc = spawn([shell], {
    cwd: workDir,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const session: TerminalSession = { id, proc, cwd: workDir, sockets: new Set() };
  sessions.set(id, session);

  // Pipe stdout to all connected WebSocket clients
  pipeStreamToSockets(session, proc.stdout);
  pipeStreamToSockets(session, proc.stderr);

  return session;
}

/** Continuously read from a ReadableStream and push data to all connected sockets. */
async function pipeStreamToSockets(
  session: TerminalSession,
  stream: ReadableStream<Uint8Array>,
) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && session.sockets.size > 0) {
        // Send raw bytes to all connected WebSocket clients
        for (const ws of session.sockets) {
          try { ws.send(value); } catch { /* socket may have closed */ }
        }
      }
    }
  } catch {
    // Stream closed or process exited
  }
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
  session.proc.stdin.write(data);
  return true;
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
