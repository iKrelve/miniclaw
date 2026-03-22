/**
 * ToolActionsGroup — compact collapsible group of tool calls.
 * Shows a summary header with counts, and expands to show individual tool rows.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CaretRight } from '@phosphor-icons/react'
import { cn } from '../../lib/utils'
import { ToolCallBlock } from '../chat/ToolCallBlock'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolAction {
  id?: string
  name: string
  input: unknown
  result?: string
  isError?: boolean
}

interface ToolActionsGroupProps {
  tools: ToolAction[]
  isStreaming?: boolean
  streamingToolOutput?: string
}

// ---------------------------------------------------------------------------
// Tool categorisation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Summary helpers
// ---------------------------------------------------------------------------

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
      if (cmd) return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd
      return name
    }
    case 'search': {
      const pattern = (inp.pattern || inp.query || inp.glob || '') as string
      return pattern ? `"${pattern.length > 50 ? pattern.slice(0, 47) + '...' : pattern}"` : name
    }
    default:
      return name
  }
}

// ---------------------------------------------------------------------------
// Header summary
// ---------------------------------------------------------------------------

function getRunningDescription(tools: ToolAction[]): string {
  const running = tools.filter((t) => t.result === undefined)
  if (running.length === 0) return ''
  const last = running[running.length - 1]
  const category = getToolCategory(last.name)
  return getToolSummary(last.name, last.input, category)
}

// ---------------------------------------------------------------------------
// Main group component
// ---------------------------------------------------------------------------

export function ToolActionsGroup({ tools, isStreaming = false }: ToolActionsGroupProps) {
  const hasRunningTool = tools.some((t) => t.result === undefined)

  // Track manual toggle
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)

  // Auto-expand when streaming, respect user override
  const expanded = userExpanded !== null ? userExpanded : hasRunningTool || isStreaming

  if (tools.length === 0) return null

  const runningCount = tools.filter((t) => t.result === undefined).length
  const doneCount = tools.length - runningCount
  const runningDesc = getRunningDescription(tools)

  const toggle = () => {
    setUserExpanded((prev) => (prev !== null ? !prev : !expanded))
  }

  // Build summary
  const parts: string[] = []
  if (runningCount > 0) parts.push(`${runningCount} running`)
  if (doneCount > 0) parts.push(`${doneCount} completed`)
  if (runningCount === 0 && isStreaming) parts.push('generating response')
  if (parts.length === 0) parts.push(`${tools.length} actions`)

  return (
    <div className="w-[min(100%,48rem)]">
      {/* Header */}
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 py-1 text-xs rounded-sm hover:bg-muted/30 transition-colors"
      >
        <CaretRight
          size={12}
          className={cn(
            'shrink-0 text-muted-foreground/60 transition-transform duration-200',
            expanded && 'rotate-90',
          )}
        />

        <span className="inline-flex items-center justify-center rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground/70 tabular-nums">
          {tools.length}
        </span>

        <span className="text-muted-foreground/60 truncate">{parts.join(' · ')}</span>

        {runningDesc && (
          <span className="ml-auto text-muted-foreground/40 text-[11px] font-mono truncate max-w-[40%]">
            {runningDesc}
          </span>
        )}
      </button>

      {/* Expanded list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden', transformOrigin: 'top' }}
          >
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
            >
              <div className="ml-1.5 mt-0.5 space-y-0.5">
                {tools.map((tool, i) => (
                  <ToolCallBlock
                    key={tool.id || `tool-${i}`}
                    name={tool.name}
                    input={tool.input}
                    result={tool.result}
                    isError={tool.isError}
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
