// ==========================================
// 小龙虾 (MiniClaw) — Shared Types
// Used by both frontend (React) and sidecar (Bun/Hono)
// ==========================================

// ==========================================
// Database Models
// ==========================================

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  model: string;
  system_prompt: string;
  working_directory: string;
  sdk_session_id: string;
  project_name: string;
  status: 'active' | 'archived';
  mode: 'code' | 'plan' | 'ask';
  provider_name: string;
  provider_id: string;
  sdk_cwd: string;
  runtime_status: 'idle' | 'running' | 'error';
  permission_profile: 'default' | 'full_access';
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  token_usage?: string;
  created_at: string;
}

export interface ApiProvider {
  id: string;
  name: string;
  type: ProviderType;
  api_key: string;
  base_url: string;
  is_active: boolean;
  created_at: string;
}

export type ProviderType = 'anthropic' | 'openai' | 'google' | 'bedrock' | 'vertex';

export interface TaskItem {
  id: string;
  session_id: string;
  content: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

// ==========================================
// SSE Stream Events
// ==========================================

export type SSEEventType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'permission_request'
  | 'mode_change'
  | 'error'
  | 'done'
  | 'token_usage';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface PermissionRequestEvent {
  id: string;
  tool_name: string;
  description: string;
  input: unknown;
}

// ==========================================
// MCP (Model Context Protocol)
// ==========================================

export interface McpServerConfig {
  type?: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export type McpStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface McpServerInfo {
  name: string;
  config: McpServerConfig;
  status: McpStatus;
  error?: string;
}

// ==========================================
// File / Project Types
// ==========================================

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  size?: number;
  extension?: string;
}

export interface FilePreview {
  path: string;
  content: string;
  language: string;
  line_count: number;
}

// ==========================================
// Settings
// ==========================================

export interface SettingsMap {
  [key: string]: string;
}

// ==========================================
// Skills
// ==========================================

export interface SkillInfo {
  name: string;
  description: string;
  version: string;
  installed: boolean;
  source: 'global' | 'project' | 'marketplace';
}

// ==========================================
// API Request/Response
// ==========================================

export interface SendMessageRequest {
  session_id: string;
  content: string;
  model?: string;
  mode?: 'code' | 'plan' | 'ask';
  provider_id?: string;
  files?: FileAttachment[];
}

export interface FileAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string; // base64
}

export interface CreateSessionRequest {
  title?: string;
  working_directory: string;
  model?: string;
  mode?: 'code' | 'plan' | 'ask';
  provider_id?: string;
}

export interface CreateProviderRequest {
  name: string;
  type: ProviderType;
  api_key: string;
  base_url?: string;
}

export interface UpdateProviderRequest {
  name?: string;
  api_key?: string;
  base_url?: string;
  is_active?: boolean;
}
