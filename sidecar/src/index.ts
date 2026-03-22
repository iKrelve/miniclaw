import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAvailablePort } from './utils/port';

const app = new Hono();

// Enable CORS for the Tauri webview origin
app.use('*', cors({ origin: '*' }));

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', uptime: process.uptime() });
});

// Placeholder routes — will be implemented in subsequent tasks
// app.route('/chat', chatRoutes);
// app.route('/sessions', sessionRoutes);
// app.route('/files', fileRoutes);
// app.route('/git', gitRoutes);
// app.route('/settings', settingsRoutes);
// app.route('/providers', providerRoutes);
// app.route('/mcp', mcpRoutes);
// app.route('/skills', skillsRoutes);
// app.route('/tasks', taskRoutes);
// app.route('/workspace', workspaceRoutes);

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
  console.error(`[sidecar] Hono server running on http://127.0.0.1:${port}`);
}

main().catch((err) => {
  console.error('[sidecar] Fatal error:', err);
  process.exit(1);
});
