/**
 * TerminalPanel — Integrated terminal using xterm.js.
 * Communicates with the sidecar's terminal service via HTTP polling.
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useSidecar } from '../../hooks/useSidecar';
import '@xterm/xterm/css/xterm.css';

export function TerminalPanel() {
  const { baseUrl, ready } = useSidecar();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);

  // Create terminal session on mount
  useEffect(() => {
    if (!baseUrl || !ready) return;

    fetch(`${baseUrl}/terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.id) setSessionId(data.id);
      })
      .catch((err) => console.error('[terminal] Failed to create session:', err));

    return () => {
      // Cleanup terminal session
      if (sessionId && baseUrl) {
        fetch(`${baseUrl}/terminal/${sessionId}`, { method: 'DELETE' }).catch(() => {});
      }
    };
  }, [baseUrl, ready]);

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const terminal = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        selectionBackground: '#364a82',
      },
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle window resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(terminalRef.current);

    terminal.writeln('\x1b[1;36m🦞 小龙虾 Terminal\x1b[0m');
    terminal.writeln('');

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Wire input to sidecar
  useEffect(() => {
    if (!xtermRef.current || !sessionId || !baseUrl) return;

    const disposable = xtermRef.current.onData((data) => {
      fetch(`${baseUrl}/terminal/${sessionId}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      }).catch(() => {});
    });

    return () => disposable.dispose();
  }, [sessionId, baseUrl]);

  // Poll stdout from sidecar
  useEffect(() => {
    if (!sessionId || !baseUrl || !xtermRef.current) return;

    const poll = async () => {
      try {
        const res = await fetch(`${baseUrl}/terminal/${sessionId}/read`);
        const data = await res.json();
        if (data.data && xtermRef.current) {
          xtermRef.current.write(data.data);
        }
      } catch {
        // ignore
      }
    };

    pollingRef.current = window.setInterval(poll, 100);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [sessionId, baseUrl]);

  return (
    <div className="flex-1 flex flex-col bg-[#1a1b26] min-h-0">
      <div className="flex items-center px-4 py-2 bg-zinc-800 border-b border-zinc-700">
        <span className="text-sm text-zinc-300">终端</span>
        {sessionId && (
          <span className="ml-2 text-xs text-zinc-500">Session: {sessionId.slice(0, 8)}...</span>
        )}
      </div>
      <div ref={terminalRef} className="flex-1 p-1" />
    </div>
  );
}
