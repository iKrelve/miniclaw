/**
 * Workspace HTTP routes — project setup, indexing, memory
 */

import { Hono } from 'hono';
import fs from 'fs';
import path from 'path';

const workspaceRoutes = new Hono();

const WORKSPACE_FILES = ['soul.md', 'user.md', 'claude.md', 'memory.md'];

/** GET /workspace?path=... — Get workspace config status */
workspaceRoutes.get('/', (c) => {
  const projectPath = c.req.query('path') || process.cwd();
  const files: Record<string, boolean> = {};
  for (const file of WORKSPACE_FILES) {
    files[file] = fs.existsSync(path.join(projectPath, file));
  }
  return c.json({ path: projectPath, files, initialized: Object.values(files).some(Boolean) });
});

/** POST /workspace/setup — Initialize workspace config files */
workspaceRoutes.post('/setup', async (c) => {
  const body = await c.req.json();
  const { path: projectPath } = body;
  if (!projectPath) return c.json({ error: 'path is required' }, 400);

  const defaults: Record<string, string> = {
    'soul.md': '# Assistant Personality\n\nYou are a helpful coding assistant.\n',
    'user.md': '# User Profile\n\n(Add your preferences here)\n',
    'claude.md': '# Project Rules\n\n(Add project-specific rules here)\n',
    'memory.md': '# Long-term Memory\n\n(The assistant will update this file with important context)\n',
  };

  const created: string[] = [];
  for (const [file, defaultContent] of Object.entries(defaults)) {
    const filePath = path.join(projectPath, file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, defaultContent, 'utf-8');
      created.push(file);
    }
  }

  return c.json({ success: true, created });
});

/** GET /workspace/context?path=... — Get workspace context for system prompt */
workspaceRoutes.get('/context', (c) => {
  const projectPath = c.req.query('path') || process.cwd();
  const context: Record<string, string> = {};
  for (const file of WORKSPACE_FILES) {
    const filePath = path.join(projectPath, file);
    if (fs.existsSync(filePath)) {
      try {
        context[file] = fs.readFileSync(filePath, 'utf-8');
      } catch {
        // skip
      }
    }
  }
  return c.json({ context });
});

export default workspaceRoutes;
