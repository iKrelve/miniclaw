/**
 * MCP HTTP routes — manage MCP server configurations
 */

import { Hono } from 'hono';
import { loadMcpServers, getMcpStatus } from '../services/mcp-manager';

const mcpRoutes = new Hono();

/** GET /mcp — List loaded MCP servers */
mcpRoutes.get('/', (c) => {
  const servers = loadMcpServers() || {};
  return c.json({
    servers: Object.entries(servers).map(([name, config]) => ({ name, config })),
  });
});

/** GET /mcp/status — Get connection status */
mcpRoutes.get('/status', (c) => {
  return c.json({ servers: getMcpStatus() });
});

export default mcpRoutes;
