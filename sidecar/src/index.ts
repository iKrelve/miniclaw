/**
 * 小龙虾 (MiniClaw) — Sidecar Entry Point
 *
 * Bun-powered Hono HTTP server. Communicates with the Tauri shell
 * via stdout "READY:{port}" protocol, then serves API requests
 * for the React frontend.
 */

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

async function main() {
  const port = await getAvailablePort();

  // Signal to Tauri that the server is ready with the port number
  // This MUST be on stdout — Tauri's sidecar manager parses it
  console.log(`READY:${port}`);

  Bun.serve({
    fetch: app.fetch,
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
