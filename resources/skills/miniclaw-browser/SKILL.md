---
name: miniclaw-browser
description: Browser automation via MiniClaw's managed Chrome instance. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data", "test this web app", "login to a site", or any task requiring browser interaction.
allowed-tools: Bash(miniclaw-desk browser-action:*), Bash(agent-browser:*)
---

# Browser Automation with MiniClaw

MiniClaw manages an external Chrome instance. The `miniclaw-desk` CLI provides a `browser-action` command that delegates to `agent-browser` connected to MiniClaw's Chrome via CDP.

## Prerequisites

- Chrome will auto-start when you run your first browser command — no manual setup needed.
- `agent-browser` must be installed globally (`npm i -g agent-browser`)

## Quick Start

```bash
# Check browser status
miniclaw-desk browser-action status

# Navigate to a URL
miniclaw-desk browser-action '{"action":"open","args":["https://example.com"]}'

# Take a snapshot (get interactive elements with refs @e1, @e2)
miniclaw-desk browser-action '{"action":"snapshot","args":["-i"]}'

# Interact using refs
miniclaw-desk browser-action '{"action":"fill","args":["@e1","user@example.com"]}'
miniclaw-desk browser-action '{"action":"click","args":["@e3"]}'

# Take a screenshot
miniclaw-desk browser-action '{"action":"screenshot"}'
```

## Core Workflow

Every browser automation follows this pattern:

1. **Navigate**: open a URL
2. **Snapshot**: `snapshot -i` to get element refs (@e1, @e2...)
3. **Interact**: Use refs to click, fill, select
4. **Re-snapshot**: After navigation or DOM changes, get fresh refs

```bash
miniclaw-desk browser-action '{"action":"open","args":["https://example.com/form"]}'
miniclaw-desk browser-action '{"action":"snapshot","args":["-i"]}'
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Submit"

miniclaw-desk browser-action '{"action":"fill","args":["@e1","user@example.com"]}'
miniclaw-desk browser-action '{"action":"fill","args":["@e2","password123"]}'
miniclaw-desk browser-action '{"action":"click","args":["@e3"]}'
miniclaw-desk browser-action '{"action":"wait","args":["--load","networkidle"]}'
miniclaw-desk browser-action '{"action":"snapshot","args":["-i"]}'
```

## Command Reference

The `browser-action` command accepts a JSON object with `action` and optional `args`:

```json
{"action": "<command>", "args": ["arg1", "arg2", ...]}
```

### Navigation

- `{"action":"open","args":["<url>"]}` — Navigate to URL
- `{"action":"back"}` — Go back
- `{"action":"forward"}` — Go forward
- `{"action":"reload"}` — Reload page

### Snapshot & Screenshot

- `{"action":"snapshot","args":["-i"]}` — Interactive elements with refs (recommended)
- `{"action":"snapshot","args":["-i","-C"]}` — Include cursor-interactive elements
- `{"action":"screenshot"}` — Screenshot to temp dir
- `{"action":"screenshot","args":["--full"]}` — Full page screenshot
- `{"action":"screenshot","args":["--annotate"]}` — Annotated screenshot with numbered labels

### Interaction (use @refs from snapshot)

- `{"action":"click","args":["@e1"]}` — Click element
- `{"action":"fill","args":["@e2","text"]}` — Clear and type text
- `{"action":"type","args":["@e2","text"]}` — Type without clearing
- `{"action":"select","args":["@e1","option"]}` — Select dropdown option
- `{"action":"check","args":["@e1"]}` — Check checkbox
- `{"action":"press","args":["Enter"]}` — Press key
- `{"action":"scroll","args":["down","500"]}` — Scroll page

### Wait

- `{"action":"wait","args":["@e1"]}` — Wait for element
- `{"action":"wait","args":["--load","networkidle"]}` — Wait for network idle
- `{"action":"wait","args":["2000"]}` — Wait milliseconds
- `{"action":"wait","args":["--text","Welcome"]}` — Wait for text to appear

### Get Information

- `{"action":"get","args":["text","@e1"]}` — Get element text
- `{"action":"get","args":["url"]}` — Get current URL
- `{"action":"get","args":["title"]}` — Get page title

### Tab Management

- `{"action":"tab","args":["new","https://example.com"]}` — Open new tab
- `{"action":"tab","args":["list"]}` — List tabs
- `{"action":"tab","args":["0"]}` — Switch to tab by index
- `{"action":"tab","args":["close"]}` — Close current tab

### JavaScript

- `{"action":"eval","args":["document.title"]}` — Evaluate JavaScript

## Session Isolation

Each MiniClaw chat session gets its own agent-browser daemon with independent state (active tab index, element refs). Multiple sessions can operate the same Chrome in parallel without interference. Cookies and profile are shared across all sessions.

## Ref Lifecycle

Refs (@e1, @e2...) are invalidated when the page changes. Always re-snapshot after:

- Clicking links or buttons that navigate
- Form submissions
- Dynamic content loading (dropdowns, modals)

```bash
miniclaw-desk browser-action '{"action":"click","args":["@e5"]}'
miniclaw-desk browser-action '{"action":"snapshot","args":["-i"]}'  # MUST re-snapshot
miniclaw-desk browser-action '{"action":"click","args":["@e1"]}'   # Use new refs
```
