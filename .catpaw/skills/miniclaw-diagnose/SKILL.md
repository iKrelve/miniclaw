# MiniClaw Diagnose Skill

Self-diagnosis toolkit for 小龙虾 (MiniClaw) development. Use when debugging runtime issues: sidecar not starting, chat failures, session stuck as busy, SDK errors, proxy credential problems, or when verifying that code changes actually work at runtime.

**Trigger keywords**: sidecar 不启动 / 对话失败 / 没有回复 / session busy / 会话卡死 / SDK 报错 / 400 错误 / stream hang / 日志 / log / 排查 / diagnose / debug / 运行时问题

---

## Data Locations

| Data              | Path                                                             |
| ----------------- | ---------------------------------------------------------------- |
| Sidecar logs      | `~/.miniclaw/logs/current.log` (symlink → active pino-roll file) |
| Database          | `~/.miniclaw/miniclaw.db` (SQLite WAL)                           |
| Proxy credentials | `~/.miniclaw/.env.local` or `{project_root}/.env.local`          |
| Settings          | `settings` table in database                                     |
| Sessions          | `chat_sessions` table in database                                |

## Step 1: Check Sidecar Health

```bash
# Find sidecar port from logs
cat ~/.miniclaw/logs/current.log | jq -r 'select(.mod=="startup" and .port) | .port' | tail -1

# Or find from running process
lsof -nP -iTCP -sTCP:LISTEN | grep bun

# Health check (replace PORT)
curl -s http://127.0.0.1:PORT/health | jq .
```

**Expected**: `{"status":"ok","uptime":...}`
**If no response**: Sidecar is not running. Check Step 2.

## Step 2: Read Sidecar Startup Logs

```bash
# Full startup log
cat ~/.miniclaw/logs/current.log | jq 'select(.mod=="startup" or .mod=="db")'

# Check for errors at any level
cat ~/.miniclaw/logs/current.log | jq 'select(.level >= 40)'
```

**Look for**:

- `"Loaded .env.local"` → confirms proxy credentials loaded
- `"Sidecar starting"` with `port` → server bound successfully
- `"Database initialized"` → DB schema OK
- `"Reset stale session locks"` → auto-recovered orphaned locks

## Step 3: Diagnose Chat Failure

```bash
# All chat + claude module logs
cat ~/.miniclaw/logs/current.log | jq 'select(.mod=="chat" or .mod=="claude")'

# Just errors
cat ~/.miniclaw/logs/current.log | jq 'select(.level >= 50 and (.mod=="chat" or .mod=="claude"))'

# Human-readable timeline
cat ~/.miniclaw/logs/current.log | jq -r 'select(.mod=="chat" or .mod=="claude") | [.time[11:19], .mod, .msg] | join(" | ")'
```

**Expected successful chat flow** (these log messages should appear in order):

1. `[chat] POST /chat request` — request received
2. `[db] Session lock acquired` — lock OK
3. `[chat] Creating SSE stream` — parameters resolved
4. `[claude] streamChat.start` — stream started, shows `resolvedCwd`
5. `[claude] SDK environment resolved` — shows `baseUrl`, `authTokenPrefix`, `customHeaders`
6. `[claude] Claude binary resolution` — shows `claudePath`
7. `[claude] Calling SDK query()` — SDK invoked
8. `[claude] SDK message received` (×N) — messages flowing
9. `[claude] Stream completed normally` — success
10. `[db] Session lock released` — lock freed

**Common failure patterns**:

| Last log before silence                                 | Root cause                                            | Fix                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Calling SDK query()` then nothing                      | SDK hang — invalid `cwd` (e.g. `"~"` not expanded)    | Check `resolvedCwd` in log; ensure tilde expansion works                                                                 |
| `Stream error caught` with `400 Request is not allowed` | Proxy rejected request — stale `X-Working-Dir` header | Restart sidecar to re-capture credentials; check `.env.local`                                                            |
| `Session busy — lock not acquired`                      | Previous stream didn't release lock                   | Restart sidecar (auto-resets) or run: `sqlite3 ~/.miniclaw/miniclaw.db "UPDATE chat_sessions SET runtime_status='idle'"` |
| `Stream error caught` with auth error                   | Expired proxy token                                   | Delete `.env.local` and restart sidecar to trigger re-capture                                                            |
| No `POST /chat request` at all                          | Frontend not sending request / wrong port             | Check `useSidecar.ts` port discovery; verify sidecar health endpoint                                                     |

## Step 4: Check Session Lock State

```bash
# Show all sessions with their runtime status
sqlite3 ~/.miniclaw/miniclaw.db "SELECT id, title, runtime_status, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 10"

# Force-reset all stuck locks
sqlite3 ~/.miniclaw/miniclaw.db "UPDATE chat_sessions SET runtime_status='idle' WHERE runtime_status='running'"
```

## Step 5: Check Proxy Credentials

```bash
# Which .env.local is active?
ls -la ~/.miniclaw/.env.local $(find . -name '.env.local' -maxdepth 1) 2>/dev/null

# Show credentials (token masked)
cat ~/.miniclaw/.env.local 2>/dev/null || cat .env.local 2>/dev/null

# Test claude CLI with same credentials
source <(grep -v '^#\|PROXY_CLI_COMMAND' .env.local) && claude --print "hi"

# Re-capture credentials via proxy CLI
mc --code --print "hi"
```

## Step 6: Verify SDK Environment

From the logs, check `SDK environment resolved` entry:

```bash
cat ~/.miniclaw/logs/current.log | jq 'select(.msg=="SDK environment resolved")'
```

**Must have**:

- `hasBaseUrl: true` + valid `baseUrl` (not empty)
- `hasAuthToken: true` + `authTokenPrefix` (not `"(not set)"`)
- `customHeaders` containing `X-Working-Dir: /absolute/path` (not `~`, not `/tmp`)

## Step 7: Test Chat End-to-End

```bash
# Get sidecar port
PORT=$(cat ~/.miniclaw/logs/current.log | jq -r 'select(.port) | .port' | tail -1)

# Create test session
SESSION=$(curl -s -X POST http://127.0.0.1:$PORT/sessions \
  -H "Content-Type: application/json" \
  -d '{"title":"diagnose-test","working_directory":"~"}' \
  | jq -r '.session.id')

# Send test message (should stream SSE events)
curl -s -N -X POST http://127.0.0.1:$PORT/chat \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION\",\"content\":\"say OK\"}" \
  | head -c 2000

# After test, check logs for the full flow
cat ~/.miniclaw/logs/current.log | jq -r "select(.sessionId==\"$SESSION\" or .session_id==\"$SESSION\") | [.time[11:19], .mod, .msg] | join(\" | \")"
```

## Step 8: Nuclear Reset

If all else fails:

```bash
# Kill all sidecar processes
pkill -f "bun.*sidecar" 2>/dev/null

# Reset database (loses all sessions/messages)
rm ~/.miniclaw/miniclaw.db

# Clear logs
rm -f ~/.miniclaw/logs/*.log

# Re-capture proxy credentials
rm -f ~/.miniclaw/.env.local .env.local

# Restart sidecar
cd sidecar && bun run src/index.ts
```

## Log Module Reference

| `mod` value | Source file                 | What it logs                                                           |
| ----------- | --------------------------- | ---------------------------------------------------------------------- |
| `startup`   | `index.ts`                  | .env.local loading, server bind, port                                  |
| `db`        | `db/index.ts`               | DB init, schema, session lock acquire/release, stale lock reset        |
| `chat`      | `routes/chat.ts`            | HTTP request params, stream lifecycle, lock management, errors         |
| `claude`    | `services/claude-client.ts` | SDK env vars, claude binary, query() call, message flow, stream errors |
| `platform`  | `services/platform.ts`      | Claude binary search result                                            |
