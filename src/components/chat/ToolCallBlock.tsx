/**
 * ToolCallBlock — Collapsible display for tool use and tool result events.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight, Wrench, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ToolUse {
  id: string
  name: string
  input: unknown
}

interface ToolResult {
  tool_use_id: string
  content: string
  is_error?: boolean
}

interface ToolCallBlockProps {
  toolUse: ToolUse
  toolResult?: ToolResult
}

export function ToolCallBlock({ toolUse, toolResult }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const isLoading = !toolResult
  const isError = toolResult?.is_error

  const statusIcon = isLoading ? (
    <Loader2 size={14} className="animate-spin text-blue-500" />
  ) : isError ? (
    <XCircle size={14} className="text-red-500" />
  ) : (
    <CheckCircle size={14} className="text-green-500" />
  )

  // Format tool name for display
  const displayName = toolUse.name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()

  return (
    <div className="my-2 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
          'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
        )}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={14} className="text-zinc-500" />
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{displayName}</span>
        <span className="ml-auto">{statusIcon}</span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          {/* Input */}
          <div className="px-3 py-2">
            <div className="text-xs font-medium text-zinc-500 mb-1">Input</div>
            <pre className="text-xs bg-zinc-50 dark:bg-zinc-900 rounded-lg p-2 overflow-x-auto max-h-48 overflow-y-auto">
              {typeof toolUse.input === 'string'
                ? toolUse.input
                : JSON.stringify(toolUse.input, null, 2)}
            </pre>
          </div>

          {/* Result */}
          {toolResult && (
            <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800">
              <div
                className={cn(
                  'text-xs font-medium mb-1',
                  isError ? 'text-red-500' : 'text-zinc-500',
                )}
              >
                {isError ? 'Error' : 'Result'}
              </div>
              <pre
                className={cn(
                  'text-xs rounded-lg p-2 overflow-x-auto max-h-48 overflow-y-auto',
                  isError
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                    : 'bg-zinc-50 dark:bg-zinc-900',
                )}
              >
                {toolResult.content || '(empty)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
