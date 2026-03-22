/**
 * 小龙虾 (MiniClaw) — Sidecar Entry Point
 *
 * Bun-powered Hono HTTP server. Communicates with the Tauri shell
 * via stdout "READY:{port}" protocol, then serves API requests
 * for the React frontend.
 */

// Load local env overrides from .env.local (not committed — covered by *.local in .gitignore).
// If scripts/refresh-env.local.sh exists (also gitignored), run it first to auto-refresh.
import fs from 'fs';
import pathMod from 'path';
import { execSync } from 'child_process';
const projectRoot = pathMod.resolve(import.meta.dir, '../..');
const envLocalPath = pathMod.join(projectRoot, '.env.local');
const refreshScript = pathMod.join(projectRoot, 'scripts', 'refresh-env.local.sh');
if (fs.existsSync(refreshScript)) {
  try {
    execSync(`bash "${refreshScript}"`, { timeout: 20000, stdio: 'pipe' });
  } catch { /* non-fatal — .env.local may still exist from previous run */ }
}
if (fs.existsSync(envLocalPath)) {
  for (const line of fs.readFileSync(envLocalPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
  console.error('[sidecar] Loaded .env.local');
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAvailablePort } from './utils/port';
import chatRoutes from './routes/chat';
import sessionRoutes from './routes/sessions';
import fileRoutes from './routes/files';
import gitRoutes from './routes/git';
import settingsRoutes from './routes/settings';
import providerRoutes from './routes/providers';
import mcpRoutes from './routes/mcp';
import skillsRoutes from './routes/skills';
import taskRoutes from './routes/tasks';
import workspaceRoutes from './routes/workspace';
import terminalRoutes from './routes/terminal';
import uploadRoutes from './routes/uploads';
import { attachSocket, detachSocket, writeToTerminal, getTerminalSession } from './services/terminal';

const app = new Hono();

// Enable CORS for the Tauri webview origin
app.use('*', cors({ origin: '*' }));

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', uptime: process.uptime() });
});

// Mount routes
app.route('/chat', chatRoutes);
app.route('/sessions', sessionRoutes);
app.route('/files', fileRoutes);
app.route('/git', gitRoutes);
app.route('/settings', settingsRoutes);
app.route('/providers', providerRoutes);
app.route('/mcp', mcpRoutes);
app.route('/skills', skillsRoutes);
app.route('/tasks', taskRoutes);
app.route('/workspace', workspaceRoutes);
app.route('/terminal', terminalRoutes);
app.route('/uploads', uploadRoutes);

async function main() {
  const port = await getAvailablePort();

  // Signal to Tauri that the server is ready with the port number
  // This MUST be on stdout — Tauri's sidecar manager parses it
  console.log(`READY:${port}`);

  Bun.serve({
    fetch(req, server) {
      // Handle WebSocket upgrade for terminal I/O
      const url = new URL(req.url);
      const wsMatch = url.pathname.match(/^\/terminal\/([^/]+)\/ws$/);
      if (wsMatch && req.headers.get('upgrade') === 'websocket') {
        const terminalId = wsMatch[1];
        if (!getTerminalSession(terminalId)) {
          return new Response('Terminal session not found', { status: 404 });
        }
        const upgraded = server.upgrade(req, { data: { terminalId } });
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 500 });
        }
        return undefined;
      }
      // All other requests go through Hono
      return app.fetch(req, server);
    },
    websocket: {
      open(ws) {
        const { terminalId } = ws.data as { terminalId: string };
        attachSocket(terminalId, ws);
      },
      message(ws, message) {
        // Forward user input to the terminal process
        const { terminalId } = ws.data as { terminalId: string };
        const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
        writeToTerminal(terminalId, data);
      },
      close(ws) {
        const { terminalId } = ws.data as { terminalId: string };
        detachSocket(terminalId, ws);
      },
    },
    port,
    hostname: '127.0.0.1',
  });

  // Log to stderr so it doesn't interfere with Tauri's READY parsing
  console.error(`[sidecar] 小龙虾 server running on http://127.0.0.1:${port}`);
}

main().catch((err) => {
  console.error('[sidecar] Fatal error:', err);
  process.exit(1);
});