/**
 * 小龙虾 (MiniClaw) — SQLite Database Module
 *
 * Uses Bun's built-in bun:sqlite with WAL mode for concurrent reads.
 * Data directory: ~/.miniclaw/miniclaw.db
 */

import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { encrypt, decrypt } from '../utils/crypto';

const DATA_DIR = process.env.MINICLAW_DATA_DIR || path.join(os.homedir(), '.miniclaw');
const DB_PATH = path.join(DATA_DIR, 'miniclaw.db');

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    logger.info('db', 'Opening database', { path: DB_PATH });
    db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    initSchema(db);
    logger.info('db', 'Database initialized');
  }
  return db;
}

function initSchema(db: Database): void {
  // Reset stale locks from previous sidecar run (any 'running' session is orphaned)
  try {
    const stale = db.prepare("SELECT id FROM chat_sessions WHERE runtime_status = 'running'").all() as { id: string }[];
    if (stale.length > 0) {
      db.prepare("UPDATE chat_sessions SET runtime_status = 'idle' WHERE runtime_status = 'running'").run();
      logger.warn('db', 'Reset stale session locks on startup', { count: stale.length, ids: stale.map(s => s.id) });
    }
  } catch {
    // Table may not exist yet on first run — that's fine, CREATE TABLE below will handle it
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      model TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      working_directory TEXT NOT NULL DEFAULT '',
      sdk_session_id TEXT NOT NULL DEFAULT '',
      project_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      mode TEXT DEFAULT 'code',
      provider_name TEXT NOT NULL DEFAULT '',
      provider_id TEXT NOT NULL DEFAULT '',
      sdk_cwd TEXT NOT NULL DEFAULT '',
      runtime_status TEXT NOT NULL DEFAULT 'idle',
      permission_profile TEXT DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      token_usage TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function genId(): string {
  return crypto.randomUUID();
}

// ==========================================
// Sessions
// ==========================================

export function createSession(opts: {
  title?: string;
  working_directory: string;
  model?: string;
  mode?: string;
  provider_id?: string;
}) {
  const d = getDb();
  const id = genId();
  d.prepare(`
    INSERT INTO chat_sessions (id, title, working_directory, model, mode, provider_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.title || 'New Chat',
    opts.working_directory,
    opts.model || '',
    opts.mode || 'code',
    opts.provider_id || ''
  );
  return getSession(id)!;
}

export function getSession(id: string) {
  return getDb()
    .prepare('SELECT * FROM chat_sessions WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
}

export function listSessions(status = 'active') {
  return getDb()
    .prepare('SELECT * FROM chat_sessions WHERE status = ? ORDER BY updated_at DESC')
    .all(status) as Record<string, unknown>[];
}

export function updateSessionTitle(id: string, title: string) {
  getDb()
    .prepare("UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title, id);
}

export function updateSessionModel(id: string, model: string) {
  getDb()
    .prepare("UPDATE chat_sessions SET model = ?, updated_at = datetime('now') WHERE id = ?")
    .run(model, id);
}

export function updateSessionProvider(id: string, providerName: string) {
  getDb()
    .prepare("UPDATE chat_sessions SET provider_name = ?, updated_at = datetime('now') WHERE id = ?")
    .run(providerName, id);
}

export function updateSdkSessionId(sessionId: string, sdkSessionId: string) {
  getDb()
    .prepare("UPDATE chat_sessions SET sdk_session_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(sdkSessionId, sessionId);
}

export function setSessionRuntimeStatus(id: string, status: string) {
  getDb()
    .prepare("UPDATE chat_sessions SET runtime_status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
}

export function deleteSession(id: string) {
  getDb().prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
}

export function archiveSession(id: string) {
  getDb()
    .prepare("UPDATE chat_sessions SET status = 'archived', updated_at = datetime('now') WHERE id = ?")
    .run(id);
}

// ==========================================
// Messages
// ==========================================

export function addMessage(sessionId: string, role: string, content: string, tokenUsage?: string | null) {
  const d = getDb();
  const id = genId();
  d.prepare(`
    INSERT INTO messages (id, session_id, role, content, token_usage)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, sessionId, role, content, tokenUsage ?? null);

  // Touch session updated_at
  d.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);

  return { id, session_id: sessionId, role, content, token_usage: tokenUsage ?? null };
}

export function getMessages(sessionId: string) {
  return getDb()
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as Record<string, unknown>[];
}

export function updateMessageContent(messageId: string, content: string) {
  const result = getDb()
    .prepare('UPDATE messages SET content = ? WHERE id = ?')
    .run(content, messageId);
  return result.changes;
}

// ==========================================
// Settings
// ==========================================

/** Settings keys that contain sensitive credentials — encrypted at rest. */
const SENSITIVE_SETTINGS = new Set([
  'anthropic_auth_token',
  'anthropic_api_key',
  'openai_api_key',
  'google_api_key',
]);

export function getSetting(key: string): string | undefined {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  if (!row) return undefined;
  // Decrypt sensitive settings transparently
  if (SENSITIVE_SETTINGS.has(key)) return decrypt(row.value);
  return row.value;
}

export function setSetting(key: string, value: string) {
  // Encrypt sensitive settings before storing
  const stored = SENSITIVE_SETTINGS.has(key) ? encrypt(value) : value;
  getDb()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, stored);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb()
    .prepare('SELECT key, value FROM settings')
    .all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    // Decrypt sensitive settings transparently
    result[row.key] = SENSITIVE_SETTINGS.has(row.key) ? decrypt(row.value) : row.value;
  }
  return result;
}

// ==========================================
// API Providers
// ==========================================

export function createProvider(opts: {
  name: string;
  type: string;
  api_key: string;
  base_url?: string;
}) {
  const id = genId();
  // Encrypt the API key before storing
  const encryptedKey = encrypt(opts.api_key);
  getDb()
    .prepare('INSERT INTO api_providers (id, name, type, api_key, base_url) VALUES (?, ?, ?, ?, ?)')
    .run(id, opts.name, opts.type, encryptedKey, opts.base_url || '');
  return getProvider(id)!;
}

export function getProvider(id: string) {
  const row = getDb()
    .prepare('SELECT * FROM api_providers WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (row && typeof row.api_key === 'string') {
    row.api_key = decrypt(row.api_key);
  }
  return row;
}

export function listProviders() {
  const rows = getDb()
    .prepare('SELECT * FROM api_providers ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  // Decrypt API keys for all returned providers
  for (const row of rows) {
    if (typeof row.api_key === 'string') {
      row.api_key = decrypt(row.api_key);
    }
  }
  return rows;
}

export function updateProvider(id: string, updates: Record<string, unknown>) {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (['name', 'api_key', 'base_url', 'is_active'].includes(key)) {
      fields.push(`${key} = ?`);
      // Encrypt api_key before storing
      if (key === 'api_key' && typeof value === 'string') {
        values.push(encrypt(value));
      } else {
        values.push(value);
      }
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  getDb()
    .prepare(`UPDATE api_providers SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
}

export function deleteProvider(id: string) {
  getDb().prepare('DELETE FROM api_providers WHERE id = ?').run(id);
}

export function activateProvider(id: string) {
  const d = getDb();
  d.prepare('UPDATE api_providers SET is_active = 0').run();
  d.prepare('UPDATE api_providers SET is_active = 1 WHERE id = ?').run(id);
}

// ==========================================
// Tasks
// ==========================================

export function createTask(sessionId: string, content: string) {
  const id = genId();
  getDb()
    .prepare('INSERT INTO tasks (id, session_id, content) VALUES (?, ?, ?)')
    .run(id, sessionId, content);
  return { id, session_id: sessionId, content, status: 'pending' };
}

export function getTasks(sessionId: string) {
  return getDb()
    .prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as Record<string, unknown>[];
}

export function updateTaskStatus(id: string, status: string) {
  getDb()
    .prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
}

export function deleteTask(id: string) {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

// ==========================================
// Session Lock (prevent concurrent requests)
// ==========================================

export function acquireSessionLock(sessionId: string): boolean {
  // Atomic CAS: only update if currently idle, returns true if lock acquired
  const result = getDb()
    .prepare(
      "UPDATE chat_sessions SET runtime_status = 'running', updated_at = datetime('now') WHERE id = ? AND runtime_status = 'idle'"
    )
    .run(sessionId);
  const acquired = result.changes > 0;
  if (!acquired) {
    // Check why lock wasn't acquired
    const session = getDb().prepare('SELECT runtime_status, updated_at FROM chat_sessions WHERE id = ?').get(sessionId) as { runtime_status: string; updated_at: string } | undefined;
    logger.warn('db', 'Failed to acquire session lock', { sessionId, currentStatus: session?.runtime_status, updatedAt: session?.updated_at });
  } else {
    logger.info('db', 'Session lock acquired', { sessionId });
  }
  return acquired;
}

export function releaseSessionLock(sessionId: string) {
  logger.info('db', 'Session lock released', { sessionId });
  setSessionRuntimeStatus(sessionId, 'idle');
}

// ==========================================
// Cleanup
// ==========================================

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
