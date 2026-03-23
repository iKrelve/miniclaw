/**
 * ToolCallBlock — expandable detail view for a single tool call.
 * Shows categorized content: Read (code), Write (diff), Bash (terminal), Search (results).
 */

import { useState, createElement } from 'react'
import {
  type Icon,
  File,
  NotePencil,
  Terminal,
  MagnifyingGlass,
  Wrench,
  SpinnerGap,
  CheckCircle,
  XCircle,
  CaretDown,
  CaretRight,
} from '@phosphor-icons/react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { CodeBlock } from '../ai-elements/code-block'
import { useSidecar } from '../../hooks/useSidecar'

type ToolStatus = 'running' | 'success' | 'error'

interface ToolCallBlockProps {
  name: string
  input: unknown
  result?: string
  isError?: boolean
  status?: ToolStatus
  duration?: number
}

// ── Tool classification ────────────────────────────────────────────────

type ToolCategory = 'read' | 'write' | 'bash' | 'search' | 'other'

function getToolCategory(name: string): ToolCategory {
  if (!name) return 'other'
  const lower = name.toLowerCase()
  if (lower === 'read' || lower === 'readfile' || lower === 'read_file') return 'read'
  if (
    lower === 'write' ||
    lower === 'edit' ||
    lower === 'writefile' ||
    lower === 'write_file' ||
    lower === 'create_file' ||
    lower === 'createfile' ||
    lower === 'notebookedit' ||
    lower === 'notebook_edit'
  )
    return 'write'
  if (
    lower === 'bash' ||
    lower === 'execute' ||
    lower === 'run' ||
    lower === 'shell' ||
    lower === 'execute_command'
  )
    return 'bash'
  if (
    lower === 'search' ||
    lower === 'glob' ||
    lower === 'grep' ||
    lower === 'find_files' ||
    lower === 'search_files' ||
    lower === 'websearch' ||
    lower === 'web_search'
  )
    return 'search'
  return 'other'
}

function getToolIcon(category: ToolCategory): Icon {
  switch (category) {
    case 'read':
      return File
    case 'write':
      return NotePencil
    case 'bash':
      return Terminal
    case 'search':
      return MagnifyingGlass
    case 'other':
      return Wrench
  }
}

function extractFilename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function getToolSummary(name: string, input: unknown, category: ToolCategory): string {
  const inp = input as Record<string, unknown> | undefined
  if (!inp) return name || 'unknown'
  switch (category) {
    case 'read':
    case 'write': {
      const path = (inp.file_path || inp.path || inp.filePath || '') as string
      return path ? extractFilename(path) : name
    }
    case 'bash': {
      const cmd = (inp.command || inp.cmd || '') as string
      if (cmd) return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd
      return name
    }
    case 'search': {
      const pattern = (inp.pattern || inp.query || inp.glob || '') as string
      return pattern ? `"${pattern}"` : name
    }
    default:
      return name
  }
}

function getFilePath(input: unknown): string {
  const inp = input as Record<string, unknown> | undefined
  if (!inp) return ''
  return (inp.file_path || inp.path || inp.filePath || '') as string
}

// ── Status indicator ───────────────────────────────────────────────────

function StatusIndicator({ status }: { status: ToolStatus }) {
  switch (status) {
    case 'running':
      return (
        <span className="relative flex h-3.5 w-3.5 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-30" />
          <SpinnerGap size={14} className="relative animate-spin text-primary" />
        </span>
      )
    case 'success':
      return <CheckCircle size={14} className="text-status-success-foreground" />
    case 'error':
      return <XCircle size={14} className="text-status-error-foreground" />
  }
}

// ── Diff rendering for Write/Edit tools ────────────────────────────────

function renderDiff(input: unknown): React.ReactNode | null {
  const inp = input as Record<string, unknown> | undefined
  if (!inp) return null

  const oldStr = (inp.old_string ?? inp.oldString ?? '') as string
  const newStr = (inp.new_string ?? inp.newString ?? '') as string

  if (!oldStr && !newStr) return null

  const oldLines = oldStr ? oldStr.split('\n') : []
  const newLines = newStr ? newStr.split('\n') : []

  return (
    <div className="my-2 rounded-md border border-border/50 overflow-hidden text-xs font-mono">
      {oldLines.map((line, i) => (
        <div key={`old-${i}`} className="flex bg-red-950/30 text-red-300">
          <span className="select-none w-8 text-right pr-2 text-red-400/60 shrink-0">-</span>
          <span className="px-2 whitespace-pre-wrap break-all">{line}</span>
        </div>
      ))}
      {newLines.map((line, i) => (
        <div key={`new-${i}`} className="flex bg-green-950/30 text-green-300">
          <span className="select-none w-8 text-right pr-2 text-green-400/60 shrink-0">+</span>
          <span className="px-2 whitespace-pre-wrap break-all">{line}</span>
        </div>
      ))}
    </div>
  )
}

// ── Language guessing from file extension ──────────────────────────────

function guessLanguage(path: string): string {
  if (!path) return 'text'
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'bash',
    toml: 'toml',
    xml: 'xml',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
  }
  return map[ext] || 'text'
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ── Screenshot path extraction ──────────────────────────────────────

const SCREENSHOT_PATH_RE = /Screenshot saved to\s+(\S+\.(?:jpg|jpeg|png))/i

/** Extract screenshot file path from a Bash tool result string. */
function extractScreenshotPath(result: string): string | null {
  // Direct match in result text
  const match = result.match(SCREENSHOT_PATH_RE)
  if (match) return match[1]

  // Also check inside JSON wrapper: {"success":true,"data":"Screenshot saved to ..."}
  try {
    const parsed = JSON.parse(result)
    const data = typeof parsed === 'object' && parsed?.data
    if (typeof data === 'string') {
      const inner = data.match(SCREENSHOT_PATH_RE)
      if (inner) return inner[1]
    }
  } catch {
    // not JSON
  }
  return null
}

// ── Icon color per category ────────────────────────────────────────────

function getIconColor(category: ToolCategory): string {
  switch (category) {
    case 'read':
      return 'text-primary'
    case 'write':
      return 'text-status-warning-foreground'
    case 'bash':
      return 'text-status-success-foreground'
    case 'search':
      return 'text-primary'
    case 'other':
      return 'text-muted-foreground'
  }
}

// ── Expanded content per category ──────────────────────────────────────

function ToolContent({
  category,
  input,
  result,
  status,
  filePath,
  baseUrl,
}: {
  category: ToolCategory
  input: unknown
  result?: string
  status: ToolStatus
  filePath: string
  baseUrl?: string | null
}) {
  switch (category) {
    case 'read':
      return (
        <div className="space-y-2">
          {filePath && (
            <div className="text-xs text-muted-foreground font-mono px-1">{filePath}</div>
          )}
          {result && (
            <CodeBlock
              code={result.slice(0, 5000)}
              language={guessLanguage(filePath)}
              showLineNumbers
            />
          )}
          {!result && status === 'running' && (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <SpinnerGap size={12} className="animate-spin" />
              Reading file...
            </div>
          )}
        </div>
      )

    case 'write': {
      const diff = renderDiff(input)
      const inp = input as Record<string, unknown> | undefined
      const content = (inp?.content || inp?.new_source || inp?.new_string || '') as string

      return (
        <div className="space-y-2">
          {filePath && (
            <div className="text-xs text-muted-foreground font-mono px-1">{filePath}</div>
          )}
          {diff}
          {!diff && content && (
            <CodeBlock
              code={content.slice(0, 5000)}
              language={guessLanguage(filePath)}
              showLineNumbers
            />
          )}
          {result && (
            <div className="text-xs text-muted-foreground px-1 mt-1">{result.slice(0, 500)}</div>
          )}
        </div>
      )
    }

    case 'bash': {
      const inp = input as Record<string, unknown> | undefined
      const command = (inp?.command || inp?.cmd || '') as string
      const screenshotPath = result ? extractScreenshotPath(result) : null

      return (
        <div className="space-y-2">
          {command && (
            <div className="rounded-md bg-zinc-950 p-3 font-mono text-xs text-zinc-100 overflow-x-auto">
              <span className="text-green-400 select-none">$ </span>
              <span className="whitespace-pre-wrap break-all">{command}</span>
            </div>
          )}
          {screenshotPath && baseUrl && (
            <div className="rounded-lg overflow-hidden border border-border/50">
              <img
                src={`${baseUrl}/browser/screenshot?path=${encodeURIComponent(screenshotPath)}`}
                alt="Browser screenshot"
                className="w-full max-h-[400px] object-contain bg-zinc-950"
                loading="lazy"
              />
            </div>
          )}
          {result && !screenshotPath && (
            <div className="rounded-md bg-zinc-950 p-3 font-mono text-xs text-zinc-300 max-h-60 overflow-auto whitespace-pre-wrap break-all">
              {result.slice(0, 5000)}
            </div>
          )}
          {!result && status === 'running' && (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <SpinnerGap size={12} className="animate-spin" />
              执行中...
            </div>
          )}
        </div>
      )
    }

    case 'search': {
      const inp = input as Record<string, unknown> | undefined
      const pattern = (inp?.pattern || inp?.query || inp?.glob || '') as string
      return (
        <div className="space-y-2">
          {pattern && (
            <div className="text-xs font-mono text-muted-foreground px-1">
              Pattern: <span className="text-foreground">{pattern}</span>
            </div>
          )}
          {result && (
            <div className="rounded-md bg-muted/50 p-2 font-mono text-xs max-h-60 overflow-auto">
              {result
                .split('\n')
                .slice(0, 50)
                .map((line, i) => (
                  <div
                    key={i}
                    className="py-0.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {line}
                  </div>
                ))}
              {result.split('\n').length > 50 && (
                <div className="pt-1 text-muted-foreground/50">
                  ... and {result.split('\n').length - 50} more lines
                </div>
              )}
            </div>
          )}
        </div>
      )
    }

    default:
      return (
        <div className="space-y-2">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Input</div>
            <pre className="overflow-x-auto whitespace-pre-wrap text-xs font-mono text-muted-foreground bg-muted/50 rounded p-2">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {result && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Output</div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs font-mono text-muted-foreground bg-muted/50 rounded p-2 max-h-60 overflow-auto">
                {result.slice(0, 3000)}
              </pre>
            </div>
          )}
        </div>
      )
  }
}

// ── Main component ─────────────────────────────────────────────────────

export function ToolCallBlock({
  name,
  input,
  result,
  isError,
  status = result !== undefined ? (isError ? 'error' : 'success') : 'running',
  duration,
}: ToolCallBlockProps) {
  const { baseUrl } = useSidecar()
  const category = getToolCategory(name)
  const toolIcon = getToolIcon(category)
  const summary = getToolSummary(name, input, category)
  const filePath = getFilePath(input)
  // Auto-expand tool calls that contain screenshots so the image is visible
  const hasScreenshot = !!(result && extractScreenshotPath(result))
  const [expanded, setExpanded] = useState(hasScreenshot)

  const borderColor = {
    running: 'border-primary/70',
    success: 'border-status-success-border',
    error: 'border-status-error-border',
  }[status]

  const bgColor = {
    running: 'bg-primary/[0.03] dark:bg-primary/[0.05]',
    success: 'bg-transparent',
    error: 'bg-status-error-muted',
  }[status]

  return (
    <div
      className={cn(
        'my-0.5 border-l-2 rounded-r-md overflow-hidden transition-colors duration-300',
        borderColor,
        bgColor,
      )}
    >
      {/* Header row — click to expand */}
      <Button
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-muted/30 h-auto rounded-none justify-start',
          expanded && 'border-b border-border/30',
        )}
      >
        {expanded ? (
          <CaretDown size={12} className="shrink-0 text-muted-foreground" />
        ) : (
          <CaretRight size={12} className="shrink-0 text-muted-foreground" />
        )}

        {createElement(toolIcon, { size: 14, className: cn('shrink-0', getIconColor(category)) })}

        <span className="font-mono text-xs truncate flex-1 text-foreground/80">{summary}</span>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {duration !== undefined && (
            <span className="text-xs text-muted-foreground">{formatDuration(duration)}</span>
          )}
          <StatusIndicator status={status} />
        </div>
      </Button>

      {/* Expanded content — CSS grid transition */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-in-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 py-2">
            <ToolContent
              category={category}
              input={input}
              result={result}
              status={status}
              filePath={filePath}
              baseUrl={baseUrl}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
