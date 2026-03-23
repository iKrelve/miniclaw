# AGENTS.md

## Project Overview

小龙虾 (MiniClaw) is a desktop AI assistant built with Tauri 2, React 19, and TypeScript. It provides a conversational AI interface powered by the Claude Code SDK (`@anthropic-ai/claude-agent-sdk`), with session management, MCP integration, file browsing, git operations, multi-provider support, and a theme system.

**Tech stack**: Tauri 2 (Rust) + React 19 + TypeScript 5.9 + Vite 8 + Tailwind CSS 4 + Zustand 5
**Sidecar runtime**: Bun 1.3.11+ + Hono HTTP server + bun:sqlite
**AI SDK**: `@anthropic-ai/claude-agent-sdk` (Claude Code) + Vercel AI SDK (`ai` + `@ai-sdk/*` for OpenAI/Google/Bedrock/Vertex)
**Logging**: Bun-native structured logger (`Bun.file().writer()`, no pino, no worker threads) → `~/.miniclaw/logs/` (NDJSON)
**Package manager**: Bun (lock file: `bun.lock`)
**Toolchain**: Oxlint (linter) + Oxfmt (formatter) + Lefthook (git hooks) + Knip (dead code)

## Architecture

The application is a **three-process architecture**:

```
┌─────────────────┐     IPC (invoke)     ┌─────────────────┐
│   Tauri Shell   │◄────────────────────►│   React UI      │
│   (Rust)        │                      │   (Renderer)    │
│   src-tauri/    │                      │   src/          │
└────────┬────────┘                      └────────┬────────┘
         │ spawns & manages                       │ HTTP fetch
         │ stdout "READY:{port}"                  │
         ▼                                        ▼
┌─────────────────────────────────────────────────────────┐
│   Bun Sidecar (Hono HTTP Server)                        │
│   sidecar/src/                                          │
│   - Claude Code SDK streaming                           │
│   - SQLite database (bun:sqlite)                         │
│   - MCP server configuration                            │
│   - File/Git/Settings/Tasks/Skills API                  │
└─────────────────────────────────────────────────────────┘
```

### Communication Flow

1. **Tauri → Sidecar**: Tauri spawns the Bun sidecar as a child process via `tauri-plugin-shell`. The sidecar prints `READY:{port}` to stdout when the HTTP server is ready.
2. **React → Tauri**: The renderer calls `invoke('get_sidecar_port')` to learn the sidecar port.
3. **React → Sidecar**: All business logic goes through HTTP `fetch()` to `http://127.0.0.1:{port}/...`. Chat uses SSE streaming via `POST /chat`. Terminal uses WebSocket via `GET /terminal/:id/ws`.

### Directory Structure

```
/shared                    # Shared TypeScript types (used by both frontend and sidecar)
└── types.ts               # ChatSession, Message, ApiProvider, SSEEvent, MCP, Skills, etc.

/src                       # React renderer process (Tauri webview)
├── App.tsx                # Root component (useTheme + useSidecar + ErrorBoundary → AppShell)
├── App.css                # Global styles (Tailwind import)
├── main.tsx               # React entry point
├── /components
│   ├── /ai-elements       # Reusable AI conversation display (conversation, message, shimmer, tool-actions-group)
│   ├── /chat              # ChatView, MessageList, MessageItem, MessageInput, StreamingMessage,
│   │                        ChatPermissionSelector, ContextUsageIndicator, FileDropZone,
│   │                        PermissionPrompt, SlashCommandPopover
│   ├── /files             # FilePanel (file tree browsing)
│   ├── /git               # GitPanel (git status/log/branches)
│   ├── /layout            # AppShell (view router), NavRail (icon navigation), ChatListPanel (session list),
│   │                        UnifiedTopBar, ConnectionStatus, ErrorBoundary, UpdateBanner
│   ├── /plugins           # McpPanel (MCP server CRUD, dual-tab: list + JSON editor)
│   ├── /settings          # SettingsView, ProviderSection, ProxySection, GeneralSection,
│   │                        ThemeSelector, FieldRow, SettingsCard
│   ├── /skills            # SkillsPanel (local/marketplace tabs), MarketplaceBrowser, MarketplaceSkillCard,
│   │                        MarketplaceSkillDetail, InstallProgressDialog
│   ├── /terminal          # TerminalPanel (xterm.js terminal)
│   └── /ui                # Base UI components (button, dialog, toast)
├── /hooks
│   ├── useDirectoryPicker.ts  # Native folder picker via Tauri dialog + localStorage caching
│   ├── useSidecar.ts          # Sidecar port discovery + fetch helper
│   ├── useSSEStream.ts        # SSE stream consumption for chat
│   └── useTheme.ts            # Theme system (dark/light/system + custom JSON themes)
├── /stores
│   └── index.ts           # Zustand store (sidecar, sessions, messages, workingDirectory, UI, settings)
├── /lib
│   ├── streamSessionManager.ts  # Singleton SSE stream manager (survives component unmount/HMR)
│   ├── /theme                   # Theme engine (apply, loader, types) for /themes/*.json
│   └── utils.ts                 # cn() utility (clsx + tailwind-merge)
└── /assets                # Static assets (logo.png, react.svg)

/sidecar                   # Bun sidecar (Hono HTTP server)
├── build.ts               # Build script (bun build --compile → Tauri binary)
├── package.json           # Sidecar dependencies (separate from frontend)
├── /src
│   ├── index.ts           # Server entry point (CORS, health, route mounting, .env.local + proxy credential refresh)
│   ├── /db
│   │   └── index.ts       # SQLite database (schema, sessions, messages, settings, providers, tasks, session lock)
│   ├── /routes
│   │   ├── chat.ts        # POST /chat (SSE stream), POST /chat/interrupt, POST /chat/permission
│   │   ├── sessions.ts    # CRUD for chat sessions + GET /:id/messages
│   │   ├── providers.ts   # CRUD for API providers + POST /:id/activate + GET /providers/models
│   │   ├── settings.ts    # Key-value settings GET/PUT
│   │   ├── files.ts       # File tree browsing + preview
│   │   ├── git.ts         # Git status/log/branches/commit/checkout
│   │   ├── mcp.ts         # MCP server CRUD (add/edit/delete/toggle) + JSON config editor + status
│   │   ├── tasks.ts       # CRUD for session tasks
│   │   ├── skills.ts      # Multi-source skill scanning + YAML front matter + CRUD (create/edit/delete)
│   │   ├── marketplace.ts # Skills marketplace (search skills.sh, install/remove via CLI, fetch SKILL.md from GitHub)
│   │   ├── terminal.ts    # POST /terminal (create), POST /:id/resize, DELETE /:id (kill), GET /:id/ws (WebSocket)
│   │   ├── uploads.ts     # File upload handling
│   │   └── workspace.ts   # Workspace config files (soul.md, user.md, claude.md, memory.md)
│   ├── /services
│   │   ├── claude-client.ts      # Claude Code SDK wrapper (SSE stream, permission handler, interrupt)
│   │   ├── mcp-manager.ts        # MCP config loader (merges ~/.claude.json + settings + .mcp.json)
│   │   ├── platform.ts           # Claude binary detection + PATH expansion
│   │   ├── provider-resolver.ts  # Multi-provider + model resolution (Anthropic/OpenAI/Google/Bedrock/Vertex)
│   │   ├── sdk-capabilities.ts   # SDK model info caching (captures models from active Query instances)
│   │   └── terminal.ts           # Bun native PTY terminal management + WebSocket I/O streaming
│   └── /utils
│       ├── crypto.ts           # AES-256-GCM credential encryption (machine-derived key)
│       ├── logger.ts           # Bun-native structured logger (Bun.file().writer(), NDJSON, rotation)
│       └── port.ts             # Available port discovery

/src-tauri                 # Tauri 2 (Rust) main process
├── Cargo.toml             # Rust dependencies
├── tauri.conf.json        # Tauri config (app name "小龙虾", window, sidecar binary, icons)
├── /capabilities
│   └── default.json       # Tauri permissions (shell:allow-spawn, dialog:default, store:default, etc.)
├── /binaries
│   └── sidecar-{triple}   # Compiled Bun sidecar binary (built by sidecar/build.ts)
└── /src
    ├── main.rs            # Entry point → lib::run()
    ├── lib.rs             # Tauri Builder setup (plugins, IPC commands, tray, sidecar lifecycle)
    └── sidecar.rs         # Sidecar process management (spawn, READY parsing, state)

/themes                    # Custom theme JSON files (12 themes)
├── default.json           # Default theme
├── tokyo-night.json       # Tokyo Night
├── nord.json              # Nord
├── rose-pine.json         # Rosé Pine
├── ...                    # everforest, github, horizon, kanagawa, night-owl, poimandres, synthwave84, vesper
```

## Development Commands

| Command                  | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `bun run dev`            | **Full dev mode**: starts Vite (port 1420) + compiles Rust + launches Tauri window |
| `bun run dev:web`        | Vite dev server only (debug UI without Tauri)                                      |
| `bun run dev:sidecar`    | Run sidecar standalone (debug API independently)                                   |
| `bun run build:sidecar`  | Build sidecar to `src-tauri/binaries/sidecar-{triple}`                             |
| `bun run build`          | **Full production build**: sidecar + frontend + Tauri packaging (DMG/installer)    |
| `bun run build:frontend` | TypeScript check + Vite production build (frontend only)                           |
| `bun run setup`          | **First-time setup**: install all deps + build sidecar binary                      |
| `bun run lint`           | Oxlint check on `src/` + `shared/`                                                 |
| `bun run lint:fix`       | Auto-fix lint issues                                                               |
| `bun run format`         | Oxfmt format all files (`--write`)                                                 |
| `bun run format:check`   | Check formatting (`--check`, CI use)                                               |
| `bun run test`           | Run sidecar tests (Bun test)                                                       |
| `bun run deadcode`       | Knip dead code / unused dependency detection                                       |
| `bun run check`          | **One-shot validation**: format:check + lint + typecheck                           |

### Prerequisites

- **Rust** — install via [rustup](https://rustup.rs/) (required for Tauri)
- **Bun** — install via [bun.sh](https://bun.sh/) (runtime for sidecar + package manager)
- **Claude Code CLI** — the sidecar calls the `claude` binary via the SDK; install it separately
- macOS: Xcode Command Line Tools

### First-Time Setup

```bash
cd miniclaw
bun run setup              # Install all deps (root + sidecar) + build sidecar binary
bun run dev                # Start full dev mode
```

> `bun install` automatically triggers `postinstall` which installs sidecar dependencies too.

## Key Architectural Patterns

### Sidecar Communication Protocol

The Tauri Rust shell spawns the sidecar and parses stdout for `READY:{port}`. The sidecar **must** print this line to stdout before any other stdout output. All diagnostic logs go to stderr and file (`Bun.file().writer()`).

### SSE Chat Streaming (Event Bus Architecture)

Chat uses a two-step fire-and-forget + SSE subscription model:

1. **`POST /chat`** — fire-and-forget: starts the Claude SDK conversation in the sidecar background, returns `{ ok, session_id }` immediately.
2. **`GET /chat/events/:sessionId`** — SSE endpoint: subscribes to the session's event stream from the sidecar-side `EventBuffer`. Supports `?after=N` query parameter for reconnect replay.

The sidecar's `EventBuffer` (`sidecar/src/services/event-buffer.ts`) accumulates all events in memory with monotonic indices. If the WebView SSE connection drops (e.g. macOS App Nap), the frontend reconnects with `?after=lastIndex` and replays missed events. The Claude SDK conversation is never interrupted — it runs entirely in the sidecar (Bun) process.

Events are JSON-encoded with an `index` field for cursor tracking:

```
data: {"type":"text","data":"Hello","index":0}
data: {"type":"tool_use","data":"{...}","index":1}
data: {"type":"tool_result","data":"{...}","index":2}
data: {"type":"status","data":"{...}","index":3}
data: {"type":"result","data":"{...}","index":4}
data: {"type":"done","data":"","index":5}
```

The frontend `useSSEStream` hook (`src/hooks/useSSEStream.ts`) handles auto-reconnect with exponential backoff (1s, 2s, 4s..., max 10 retries). Heartbeat comments (`: heartbeat`) are sent every 5 seconds to keep the connection alive.

### Database

SQLite via `bun:sqlite` with WAL mode. Located at `~/.miniclaw/miniclaw.db`.

Tables: `chat_sessions`, `messages`, `settings`, `tasks`, `api_providers`.

### MCP Server Configuration & Management

Config loaded from three sources (later overrides earlier):

1. `~/.claude.json` → `mcpServers` (global)
2. `~/.claude/settings.json` → `mcpServers` (user)
3. Project `.mcp.json` → `mcpServers` (project)

Environment variable placeholders (`${KEY}`) are resolved against the DB `settings` table.

**CRUD operations** (via `mcp.ts` route): add, edit, delete, toggle (enable/disable). User-level writes go to `~/.claude/settings.json`. Each server tracks its `source` (global/user/project). The UI offers dual views: card list + raw JSON editor.

### Skills System

Skills are reusable prompt templates discoverable via `/` slash commands. Two kinds:

| Kind            | Format                                   | Example                                 |
| --------------- | ---------------------------------------- | --------------------------------------- |
| `slash_command` | `*.md` file                              | `~/.claude/commands/review.md`          |
| `agent_skill`   | `{name}/SKILL.md` with YAML front matter | `~/.agents/skills/git-release/SKILL.md` |

**Scan directories** (in order):

1. `~/.claude/commands/` — global slash commands
2. `<cwd>/.claude/commands/` — project slash commands
3. `<cwd>/.claude/skills/*/SKILL.md` — project agent skills
4. `~/.agents/skills/*/SKILL.md` — installed agent skills (agents source)
5. `~/.claude/skills/*/SKILL.md` — installed agent skills (claude source)
6. `~/.miniclaw/skills/` — legacy miniclaw skills

**YAML front matter** (for SKILL.md): `name` and `description` fields, supports multi-line block scalar (`|`).

**Deduplication**: installed skills from `~/.agents/skills/` and `~/.claude/skills/` are content-hash deduplicated; preferred source is the one with more skills.

**CRUD**: create (global/project slash commands), edit content, delete. Agent skills (SKILL.md) are read-only via the API.

**Marketplace**: The SkillsPanel has a "技能市场" tab that searches [skills.sh](https://skills.sh) via `/marketplace/search`, displays SKILL.md from GitHub via `/marketplace/readme`, and installs/removes skills via `npx skills add/remove` with SSE progress streaming. Lock file at `~/.agents/.skill-lock.json` tracks installed marketplace skills.

### Slash Command Integration

Inputting `/` in `MessageInput` triggers the `SlashCommandPopover`, which lists available skills. Selecting a skill:

1. Displays a badge chip above the textarea (shows `/{name}`)
2. On send, the skill's full content is passed as `systemPromptAppend`
3. The chat route appends it to the session's system prompt before calling the SDK

**Data flow**: `MessageInput` → `SlashCommandPopover` → `SelectedSkill` → `useSSEStream.send({ systemPromptAppend })` → `POST /chat { systemPromptAppend }` → `claude-client.ts` (SDK `systemPrompt.append`).

### Claude Binary Detection

`platform.ts` searches for the `claude` binary in standard locations (`~/.local/bin`, `~/.claude/bin`, `~/.bun/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, etc.) and caches the result. If found, it's passed as `pathToClaudeCodeExecutable` to the SDK.

### Logging System

**Bun-native structured logger** using `Bun.file().writer()` for async file writes — no pino, no worker threads. Fully compatible with `bun build --compile`.

| Item          | Value                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Log directory | `~/.miniclaw/logs/`                                                                             |
| Active log    | `~/.miniclaw/logs/sidecar.log` (rotated to `sidecar.log.1`, `.2`, `.3`)                         |
| Rotation      | Size-based, 5MB per file, keep 3 old files, checked every 60s                                   |
| Format        | NDJSON (one JSON object per line, pino-compatible numeric levels)                               |
| Levels        | `debug` (20) / `info` (30) / `warn` (40) / `error` (50)                                         |
| Module field  | `mod` (e.g. `"mod":"claude"`, `"mod":"chat"`, `"mod":"db"`)                                     |
| Dual output   | File (async `Bun.file().writer()`) + stderr (sync, stdout reserved for `READY:{port}` protocol) |

**Quick log commands:**

```bash
# Tail live logs
tail -f ~/.miniclaw/logs/sidecar.log

# Filter by module
cat ~/.miniclaw/logs/sidecar.log | jq 'select(.mod=="claude")'

# Filter errors only
cat ~/.miniclaw/logs/sidecar.log | jq 'select(.level >= 50)'

# Show human-readable summary
cat ~/.miniclaw/logs/sidecar.log | jq -r '[.time, .mod, .msg] | join(" | ")'
```

### Theme System

MiniClaw supports 12 custom themes via JSON files in `/themes/`. The theme engine (`src/lib/theme/`) loads theme JSON, resolves CSS variables, and applies them at runtime. `ThemeSelector` in Settings provides the UI. Themes support dark mode variants.

### Multi-Provider Architecture

The `provider-resolver.ts` service supports multiple AI providers with a built-in model catalog:

- **Anthropic** (Claude via SDK shorthand: `sonnet`, `opus`, `haiku`)
- **OpenAI** (`gpt-4o`, `gpt-4o-mini`, `o3-mini`, `gpt-4-turbo`)
- **Google** (`gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`)
- **Bedrock** (Claude via AWS Bedrock — auto-scanned from AWS account)
- **Vertex** (Claude via Google Vertex AI)
- **Custom** (user-typed model name)

Resolution priority: request → session → default setting → env. The `sdk-capabilities.ts` service caches real model lists from active Claude Code SDK Query instances.

### AWS Bedrock Auto-Scan

On startup, the sidecar automatically detects local AWS credentials and scans available Bedrock models:

1. **Credential Detection** — Uses `@aws-sdk/credential-providers` to resolve credentials from:
   - Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
   - AWS profile (`AWS_PROFILE`, `CLAUDE_CODE_AWS_PROFILE`)
   - `~/.aws/credentials` default profile
   - IMDS (EC2 instance metadata) if applicable

2. **Model Scanning** — Calls `BedrockClient.listFoundationModels()` to discover available Claude models in the detected region.

3. **Auto-Registration** — If valid credentials exist, an "AWS Bedrock" provider is auto-registered with:
   - `extra_env` containing `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION`, and optional `CLAUDE_CODE_AWS_PROFILE`
   - Dynamic model list cached in `BEDROCK_MODELS` (used by `provider-resolver.ts`)

4. **Runtime Injection** — When a Bedrock provider is used for chat, `claude-client.ts` injects the `extra_env` variables into the SDK environment.

The `extra_env` field in `api_providers` table stores provider-specific environment variables as JSON.

### Proxy Credential Auto-Refresh (`.env.local`)

If `PROXY_CLI_COMMAND` is set in `.env.local`, the sidecar runs a wrapper trick on startup to capture `ANTHROPIC_*` env vars from the proxy CLI. Two `.env.local` locations (first match wins):

1. Project root (dev mode)
2. `~/.miniclaw/.env.local` (production)

The proxy provider is auto-registered as "MCopilot" in the database on startup if credentials are captured successfully.

The `X-Working-Dir` custom header is **dynamically overridden** per chat request with the actual session `cwd` (not the stale `.env.local` value).

### StreamSessionManager (Singleton)

`streamSessionManager.ts` manages SSE streams independently of React component lifecycle. It uses a publish-subscribe pattern:

- `startStream()` — initiates SSE fetch, accumulates text + events
- `subscribe()` — components subscribe for real-time snapshots
- `abortStream()` / `clear()` — cleanup

The singleton survives HMR via `globalThis` caching.

## Strict Code Rules (non-negotiable)

- **Never add `@ts-nocheck` or `@ts-ignore`** — fix the root cause.
- **Avoid `any`** — prefer strict typing. If unavoidable, add a comment.
- **Must** use `cn()` from `@/lib/utils` for conditional class names — never use template literal className.
- **Must** add brief code comments for tricky or non-obvious logic.
- **Shared types go in `shared/types.ts`** — never duplicate types between frontend and sidecar.
- **Sidecar stdout is reserved for the `READY:{port}` protocol** — all logging uses the Bun-native logger (writes to file + stderr, never stdout).

## Code Style & Conventions

### File Naming

| Type             | Convention         | Example             |
| ---------------- | ------------------ | ------------------- |
| Components       | PascalCase `.tsx`  | `ChatView.tsx`      |
| Hooks            | `use` prefix `.ts` | `useSidecar.ts`     |
| Routes (sidecar) | kebab-case `.ts`   | `chat.ts`, `mcp.ts` |
| Services         | kebab-case `.ts`   | `claude-client.ts`  |
| Themes           | kebab-case `.json` | `tokyo-night.json`  |

### TypeScript Configuration

- **Renderer** (`tsconfig.json`): `bundler` module resolution, `react-jsx`, strict mode, path aliases `@/` → `src/`, `@shared/` → `shared/`
- **Sidecar** (`sidecar/tsconfig.json`): `bundler` module resolution, `ES2022`, `@shared/*` path alias, `@types/bun` for Bun API type checking
- **Vite/Node** (`tsconfig.node.json`): for `vite.config.ts` only

### Lint & Formatting

- **Linter**: Oxlint (`oxlint.json`) — React hooks rules, no-unused-vars, prefer-const, eqeqeq, no-explicit-any (warn), react-refresh
- **Formatter**: Oxfmt (`.oxfmtrc.json`) — 100 printWidth, 2-space indent, single quotes, no semicolons, trailing commas, LF line endings
- **Git hooks**: Lefthook (`lefthook.yml`) — pre-commit: lint + format check (parallel); pre-push: typecheck + test
- **Dead code**: Knip (`knip.config.ts`) — detect unused files/exports/dependencies
- **Before committing**: run `bun run check` (format + lint + typecheck)

### Styling

- **Tailwind CSS v4** with Vite plugin
- Dark mode via `dark:` prefix (class-based)
- Color scheme: `zinc` neutrals + `blue` accent (default theme), customizable via `/themes/*.json`
- No CSS-in-JS, no styled-components

### Key External Dependencies (Frontend)

| Category  | Packages                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------- |
| UI        | `@radix-ui/*` (dialog, dropdown-menu, scroll-area, select, switch, tabs, tooltip, collapsible)            |
| Icons     | `@phosphor-icons/react`, `lucide-react`                                                                   |
| Animation | `motion` (Framer Motion v12)                                                                              |
| Markdown  | `streamdown` + plugins (`@streamdown/cjk`, `@streamdown/code`, `@streamdown/math`, `@streamdown/mermaid`) |
| Routing   | `react-router-dom` v7                                                                                     |
| Terminal  | `@xterm/xterm`, `@xterm/addon-fit`                                                                        |
| Toast     | `sonner`                                                                                                  |
| Scroll    | `use-stick-to-bottom`                                                                                     |
| State     | `zustand` v5                                                                                              |
| Styling   | `tailwind-merge`, `clsx`, `class-variance-authority`                                                      |
| Tauri     | `@tauri-apps/api`, `@tauri-apps/plugin-*` (shell, global-shortcut, opener, store, updater, window-state)  |

### Key External Dependencies (Sidecar)

| Category  | Packages                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| AI SDK    | `@anthropic-ai/claude-agent-sdk`, `ai` (Vercel AI SDK)                                                     |
| Providers | `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/google-vertex`, `@ai-sdk/amazon-bedrock` |
| HTTP      | `hono`                                                                                                     |

## AI Assistant Rules

### Core Principles

- **Never use simplified or lazy solutions** — always use the correct, architecturally sound approach.
- **Prefer the most reasonable and elegant solution, not the shortest one** — when multiple approaches exist, choose the one with the best architecture, maintainability, and clarity. Brevity must never come at the cost of correctness, readability, or long-term quality. A few extra lines of well-structured code are always preferable to a clever one-liner that obscures intent.
- **Verify in code, do not guess** — read source code before concluding on a bug.
- **Do not run commands automatically** unless the user explicitly requests it.
- **Prefer mature open-source libraries** — never hand-write components that have well-established solutions.

### Command Restrictions

| Forbidden (Proactive)               | Reason                                | Safe Alternative                  |
| ----------------------------------- | ------------------------------------- | --------------------------------- |
| `bun run tauri build`               | Slow packaging, irrelevant during dev | `bun run build` for build check   |
| Editing `dist/` or `dist-electron/` | Generated output                      | Edit source files                 |
| Editing `node_modules/`             | Overwritten on install                | Fix in source                     |
| Editing `src-tauri/binaries/`       | Generated by sidecar build            | Run `cd sidecar && bun run build` |
| `git stash` / `git stash pop`       | Risky with multiple agents            | Commit WIP to a branch            |

### Dependency Recovery

1. Run `bun install` (in both root and `sidecar/`)
2. Re-run the exact failing command once
3. If retry still fails, report the command and first actionable error — do not loop

### Debugging Guidelines

- **Always read logs first**: `cat ~/.miniclaw/logs/sidecar.log | jq .` — the sidecar instruments all key paths with structured logs.
- **Sidecar not starting**: Check `~/.miniclaw/logs/sidecar.log` for startup errors. Also check stderr in terminal for `[sidecar:stderr]` lines.
- **Chat silent failure / no response**: Read logs for `mod=="chat"` and `mod=="claude"` — look for `Stream error caught`, `Session busy`, or missing `Stream completed normally`.
- **Session stuck as "busy"**: The sidecar resets all stale `runtime_status='running'` sessions to `idle` on startup. Restart the sidecar to auto-fix. Or manually: `sqlite3 ~/.miniclaw/miniclaw.db "UPDATE chat_sessions SET runtime_status='idle'"`
- **Port already in use**: Run `lsof -ti:1420 | xargs kill -9` to free the Vite port, or check for orphaned sidecar processes.
- **Claude SDK errors**: Logs show `claudePath`, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_AUTH_TOKEN` (masked). Verify claude binary is accessible.
- **Database issues**: Data lives in `~/.miniclaw/miniclaw.db`. Delete it to reset all state.
- **Trace the call chain**: React hook → HTTP fetch → Hono route → service → database/SDK.
- **Diagnose skill**: Use `$miniclaw-diagnose` skill (`.catpaw/skills/miniclaw-diagnose/SKILL.md`) for structured diagnostic workflows.

## Critical Known Pitfalls

### Tilde (`~`) Path Expansion (Hard-Won Lesson)

Node.js/Bun `child_process` does **NOT** expand `~` to the home directory — it's a shell feature. If `working_directory` is `"~"`, the SDK's `query()` will hang forever (subprocess spawn with invalid cwd).

**Fix**: `claude-client.ts` resolves `~` → `os.homedir()` before passing to the SDK. Any new code that passes paths to `child_process`, `fs`, or SDK options **must** expand `~` first.

### `ANTHROPIC_CUSTOM_HEADERS` X-Working-Dir (Hard-Won Lesson)

The proxy CLI (`mc --code`) injects `X-Working-Dir` into `ANTHROPIC_CUSTOM_HEADERS` based on the **capture-time** working directory. If the sidecar refreshes credentials from `/tmp` (via the wrapper trick), the header points to `/tmp` and the proxy rejects requests with `400 Request is not allowed`.

**Fix**: `claude-client.ts` dynamically overrides `X-Working-Dir` with the session's actual resolved `cwd` before each SDK call.

### Tauri 2 API: No `Builder::on_event()`

Tauri 2 removed `Builder::on_event()`. Use `Builder::build(context).run(closure)` pattern instead. The `App::run()` closure receives `(&AppHandle, RunEvent)`.

### Rust Lifetime: MutexGuard in `if let`

When using `app.state::<Mutex<T>>()` inside a `run` closure, the `MutexGuard` from `.lock()` must be dropped before the outer binding. Use `};` (semicolon after the `if let` block) or rename the inner variable to avoid shadowing.

### Sidecar stdout Protocol

The sidecar **must** print `READY:{port}\n` to stdout. Anything else on stdout before this line will break the Tauri startup handshake. The Rust side (`sidecar.rs`) has a 30-second timeout — if `READY` is not received, the app reports sidecar failure.

### Vite Port 1420 Conflict

`tauri.conf.json` hardcodes `devUrl: "http://localhost:1420"` and Vite uses `strictPort: true`. If port 1420 is already in use, `bun run tauri dev` will fail. Kill the occupying process first.

### Sidecar Build for Tauri

Tauri expects the sidecar binary at `src-tauri/binaries/sidecar-{target-triple}` (e.g. `sidecar-aarch64-apple-darwin`). Run `cd sidecar && bun run build` to generate it. The build script uses `rustc --print host-tuple` to determine the target triple.

### Session Lock Prevents Concurrent Chat

`acquireSessionLock()` uses an atomic SQL CAS (`UPDATE ... WHERE runtime_status = 'idle'`) to prevent concurrent requests.

**Auto-recovery**: On sidecar startup, `initSchema()` resets all `runtime_status = 'running'` sessions back to `idle` (orphaned locks from previous crashes). The `transformedStream` catch block also ensures lock release on stream errors.

**Manual recovery**: `sqlite3 ~/.miniclaw/miniclaw.db "UPDATE chat_sessions SET runtime_status='idle'"`

### Sidecar Process Cleanup

`SidecarState` in `sidecar.rs` holds the `CommandChild` handle. On app exit (`ExitRequested`), `stop()` calls `child.kill()` to terminate the sidecar process. This prevents orphaned sidecar processes after Tauri quits.

### `bun build --compile` Compatibility (Critical)

The sidecar is compiled to a single binary via `bun build --compile`. This means:

- **No `pino` or `pino.transport()`** — worker threads dynamically require target modules which don't exist inside the bunfs virtual filesystem. The logger uses `Bun.file().writer()` instead.
- **No native `.node` addons** — packages like `node-pty`, `better-sqlite3` (npm version) that ship C++ addons won't load from inside the binary. Use Bun built-ins (`bun:sqlite`, `Bun.spawn({ terminal })`) instead.
- **Bun native PTY** — `Bun.spawn([shell], { terminal: { cols, rows, data() } })` provides real PTY support with zero external dependencies. The subprocess sees a real `/dev/ttys*` and supports `proc.terminal.write()`, `proc.terminal.resize()`, `proc.terminal.close()`.

### Credential Encryption (API Keys)

API keys and sensitive settings are encrypted at rest in SQLite using AES-256-GCM (`sidecar/src/utils/crypto.ts`).

- **Key derivation**: PBKDF2 from machine fingerprint (hostname + homedir + platform + arch) — keys are decryptable only on the same machine.
- **Encrypted format**: `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
- **Transparent migration**: `decrypt()` passes through values without the `enc:v1:` prefix unchanged, so existing plaintext data works without migration.
- **Encrypted fields**: `api_providers.api_key` + settings keys in `SENSITIVE_SETTINGS` set (`anthropic_auth_token`, `anthropic_api_key`, `openai_api_key`, `google_api_key`).
- **Never store API keys in plaintext** — all provider CRUD and sensitive settings go through `encrypt()`/`decrypt()` in `db/index.ts`.

## Sidecar API Reference

| Method | Path                          | Purpose                                                           |
| ------ | ----------------------------- | ----------------------------------------------------------------- |
| GET    | `/health`                     | Health check                                                      |
| POST   | `/chat`                       | Fire-and-forget: start conversation, returns `{ ok, session_id }` |
| GET    | `/chat/events/:id`            | SSE event stream (supports `?after=N` for reconnect replay)       |
| POST   | `/chat/interrupt`             | Interrupt active stream                                           |
| POST   | `/chat/permission`            | Respond to tool permission request                                |
| POST   | `/terminal`                   | Create a new terminal session (accepts `cols`, `rows`)            |
| POST   | `/terminal/:id/resize`        | Resize terminal PTY (`cols`, `rows`)                              |
| GET    | `/terminal/:id/ws`            | WebSocket for real-time terminal I/O                              |
| DELETE | `/terminal/:id`               | Kill a terminal session                                           |
| POST   | `/uploads`                    | File upload handling                                              |
| GET    | `/sessions`                   | List sessions                                                     |
| POST   | `/sessions`                   | Create session                                                    |
| GET    | `/sessions/:id`               | Get session                                                       |
| PUT    | `/sessions/:id`               | Update session                                                    |
| DELETE | `/sessions/:id`               | Delete session                                                    |
| GET    | `/sessions/:id/messages`      | Get messages for session                                          |
| GET    | `/providers`                  | List API providers                                                |
| POST   | `/providers`                  | Create provider                                                   |
| PUT    | `/providers/:id`              | Update provider                                                   |
| DELETE | `/providers/:id`              | Delete provider                                                   |
| POST   | `/providers/:id/activate`     | Set as default provider                                           |
| GET    | `/settings`                   | Get all settings                                                  |
| PUT    | `/settings`                   | Bulk update settings                                              |
| PUT    | `/settings/:key`              | Update single setting                                             |
| GET    | `/files/browse?path=...`      | Browse directory tree                                             |
| GET    | `/files/preview?path=...`     | Preview file content                                              |
| GET    | `/git/status?cwd=...`         | Git status                                                        |
| GET    | `/git/log?cwd=...`            | Git log                                                           |
| GET    | `/git/branches?cwd=...`       | List branches                                                     |
| POST   | `/git/commit`                 | Stage and commit                                                  |
| POST   | `/git/checkout`               | Switch branch                                                     |
| GET    | `/mcp`                        | List MCP servers (merged config + source + status)                |
| GET    | `/mcp/status`                 | MCP connection status                                             |
| GET    | `/mcp/config`                 | Raw JSON config for editor                                        |
| PUT    | `/mcp/config`                 | Save entire JSON config                                           |
| POST   | `/mcp`                        | Add a new MCP server                                              |
| PUT    | `/mcp/:name`                  | Update MCP server config                                          |
| DELETE | `/mcp/:name`                  | Remove MCP server                                                 |
| PUT    | `/mcp/:name/toggle`           | Enable/disable MCP server                                         |
| GET    | `/tasks?session_id=...`       | List tasks for session                                            |
| POST   | `/tasks`                      | Create task                                                       |
| PUT    | `/tasks/:id`                  | Update task status                                                |
| DELETE | `/tasks/:id`                  | Delete task                                                       |
| GET    | `/skills`                     | List all skills (multi-source, supports `?cwd=`)                  |
| GET    | `/skills/:name`               | Get skill content (supports `?source=` for installed)             |
| POST   | `/skills`                     | Create slash command (name, content, scope)                       |
| PATCH  | `/skills/:name`               | Update skill content                                              |
| DELETE | `/skills/:name`               | Delete slash command                                              |
| GET    | `/marketplace/search`         | Search skills.sh marketplace (proxy, marks installed)             |
| POST   | `/marketplace/install`        | Install skill via CLI (SSE progress stream)                       |
| POST   | `/marketplace/remove`         | Uninstall skill via CLI (SSE progress stream)                     |
| GET    | `/marketplace/readme`         | Fetch SKILL.md from GitHub (cached, `?source=&skillId=`)          |
| GET    | `/workspace?path=...`         | Get workspace config status                                       |
| POST   | `/workspace/setup`            | Initialize workspace config files                                 |
| GET    | `/workspace/context?path=...` | Get workspace context for system prompt                           |

## Tauri IPC Commands

| Command            | Parameters | Returns          | Purpose                                  |
| ------------------ | ---------- | ---------------- | ---------------------------------------- |
| `get_sidecar_port` | —          | `u16`            | Get the HTTP port of the running sidecar |
| `get_platform`     | —          | `String`         | Get the current OS name                  |
| `select_directory` | —          | `Option<String>` | Open native folder picker dialog         |

## Tauri Plugins

| Plugin                         | Purpose                                  |
| ------------------------------ | ---------------------------------------- |
| `tauri-plugin-opener`          | Open URLs/files with system default app  |
| `tauri-plugin-dialog`          | Native file/folder picker dialogs        |
| `tauri-plugin-shell`           | Spawn sidecar process                    |
| `tauri-plugin-global-shortcut` | System-wide keyboard shortcuts           |
| `tauri-plugin-window-state`    | Persist/restore window size and position |
| `tauri-plugin-store`           | Persistent key-value store (Tauri side)  |
| `tauri-plugin-updater`         | In-app update support                    |

## Git Workflow

- Conventional Commits: `feat(chat): add streaming indicator`, `fix(sidecar): handle port conflict`
- Group related changes in a single commit; never bundle unrelated refactors.
- **Before committing**: run `bun run check` (format + lint + typecheck)
- When the user says "commit", scope to your changes only.

## Self-Maintenance of AGENTS.md

After completing a task, evaluate whether to update this file:

| #   | Question (YES → update required)         | What to Update                |
| --- | ---------------------------------------- | ----------------------------- |
| 1   | Added a new sidecar API route?           | API Reference table           |
| 2   | Added a new Tauri IPC command?           | Tauri IPC Commands table      |
| 3   | Added a new Tauri plugin?                | Tauri Plugins table           |
| 4   | Changed the sidecar protocol?            | Architecture / Known Pitfalls |
| 5   | Added a new database table?              | Database section              |
| 6   | Established a new architectural pattern? | Key Architectural Patterns    |
| 7   | Added a new AI provider or SDK?          | Multi-Provider Architecture   |

**If ALL answers are NO** → skip update.
**Do NOT update for**: bug fixes, minor refactors, feature additions following existing patterns.
