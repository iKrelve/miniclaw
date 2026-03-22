/**
 * ContextUsageIndicator — Shows token usage for the current conversation.
 */

import { useMemo } from 'react'
import { cn } from '../../lib/utils'
import type { StreamMessage } from '../../hooks/useSSEStream'

interface ContextUsageIndicatorProps {
  streamEvents: StreamMessage[]
}

interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function ContextUsageIndicator({ streamEvents }: ContextUsageIndicatorProps) {
  const usage = useMemo(() => {
    let total: TokenUsage | null = null
    for (const e of streamEvents) {
      if (e.type === 'result') {
        try {
          const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
          const d = data as { usage?: TokenUsage }
          if (d.usage) total = d.usage
        } catch {
          // ignore
        }
      }
    }
    return total
  }, [streamEvents])

  if (!usage) return null

  const total = usage.input_tokens + usage.output_tokens
  const maxContext = 200000 // Anthropic default
  const pct = Math.min((usage.input_tokens / maxContext) * 100, 100)

  const barColor = pct > 80 ? 'bg-status-error' : pct > 50 ? 'bg-status-warning' : 'bg-primary'

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-xs text-muted-foreground border-t border-border">
      {/* Progress bar */}
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Numbers */}
      <div className="flex items-center gap-2 shrink-0">
        <span title="Input tokens">↓{usage.input_tokens.toLocaleString()}</span>
        <span title="Output tokens">↑{usage.output_tokens.toLocaleString()}</span>
        {usage.cache_read_input_tokens ? (
          <span title="Cache read" className="text-status-success-foreground">
            ⚡{usage.cache_read_input_tokens.toLocaleString()}
          </span>
        ) : null}
        <span className="text-muted-foreground/60">Σ{total.toLocaleString()}</span>
      </div>
    </div>
  )
}
