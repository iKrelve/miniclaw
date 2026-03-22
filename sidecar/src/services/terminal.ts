/**
 * Terminal Service — PTY management for integrated terminal.
 *
 * Uses Bun's subprocess API to spawn shells.
 * Communication with the frontend is via WebSocket.
 */

import { spawn, type Subprocess } from 'bun';
import os from 'os';

interface TerminalSession {
  id: string;
  proc: Subprocess;
  cwd: string;
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

  const session: TerminalSession = { id, proc, cwd: workDir };
  sessions.set(id, session);
  return session;
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
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
  session.proc.kill();
  sessions.delete(id);
  return true;
}

export function killAllTerminals(): void {
  for (const [id, session] of sessions) {
    try { session.proc.kill(); } catch { /* ignore */ }
    sessions.delete(id);
  }
}
