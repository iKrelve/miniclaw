/**
 * File HTTP routes — browse and preview project files
 */

import { Hono } from 'hono';
import fs from 'fs';
import path from 'path';

const fileRoutes = new Hono();

/** Ignored directories for file browsing */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'dist-electron',
  'release', '.cache', '.turbo', 'target', '__pycache__',
  '.venv', 'venv', '.tox', 'coverage', '.nyc_output',
]);

/** Max depth for recursive browse */
const MAX_DEPTH = 5;

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  extension?: string;
}

function buildTree(dirPath: string, depth = 0): FileNode[] {
  if (depth > MAX_DEPTH) return [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const nodes: FileNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.mcp.json') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children: buildTree(fullPath, depth + 1),
        });
      } else {
        try {
          const stats = fs.statSync(fullPath);
          nodes.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
            size: stats.size,
            extension: path.extname(entry.name).slice(1),
          });
        } catch {
          nodes.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
            extension: path.extname(entry.name).slice(1),
          });
        }
      }
    }
    // Sort: directories first, then alphabetical
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

/** GET /files/browse?path=... — Browse directory tree */
fileRoutes.get('/browse', (c) => {
  const dirPath = c.req.query('path') || process.cwd();
  if (!fs.existsSync(dirPath)) {
    return c.json({ error: 'Directory not found' }, 404);
  }
  const tree = buildTree(dirPath);
  return c.json({ tree, root: dirPath });
});

/** GET /files/preview?path=... — Preview file content */
fileRoutes.get('/preview', (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'path is required' }, 400);
  if (!fs.existsSync(filePath)) return c.json({ error: 'File not found' }, 404);

  try {
    const stats = fs.statSync(filePath);
    if (stats.size > 1_000_000) {
      return c.json({ error: 'File too large (>1MB)' }, 413);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath).slice(1);
    const lines = content.split('\n').length;
    return c.json({
      path: filePath,
      content,
      language: ext || 'text',
      line_count: lines,
    });
  } catch (err) {
    return c.json({ error: 'Failed to read file' }, 500);
  }
});

export default fileRoutes;
