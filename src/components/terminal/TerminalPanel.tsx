/**
 * TerminalPanel — Integrated terminal using xterm.js.
 * Communicates with the sidecar via WebSocket for real-time I/O.
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
  const wsRef = useRef<WebSocket | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Create terminal session on mount
  useEffect(() => {
    if (!baseUrl || !ready) return;

    let active = true;
    let createdId: string | null = null;

    fetch(`${baseUrl}/terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((data) => {
        if (active && data.id) {
          createdId = data.id;
          setSessionId(data.id);
        }
      })
      .catch((err) => console.error('[terminal] Failed to create session:', err));

    return () => {
      active = false;
      // Cleanup terminal session
      if (createdId && baseUrl) {
        fetch(`${baseUrl}/terminal/${createdId}`, { method: 'DELETE' }).catch(() => {});
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

    // Handle container resize
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

  // Connect WebSocket for real-time terminal I/O
  useEffect(() => {
    if (!sessionId || !baseUrl || !xtermRef.current) return;

    // Derive WebSocket URL from HTTP baseUrl
    const wsUrl = baseUrl.replace(/^http/, 'ws') + `/terminal/${sessionId}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (event) => {
      if (!xtermRef.current) return;
      if (event.data instanceof ArrayBuffer) {
        xtermRef.current.write(new Uint8Array(event.data));
      } else {
        xtermRef.current.write(event.data);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    // Forward user keystrokes to sidecar via WebSocket
    const disposable = xtermRef.current.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    return () => {
      disposable.dispose();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
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
