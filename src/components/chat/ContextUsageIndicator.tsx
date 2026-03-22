/**
 * ContextUsageIndicator — circular ring showing context window usage
 * with hover card showing detailed token breakdown.
 */

import { useMemo, useState } from 'react'
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

function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

export function ContextUsageIndicator({ streamEvents }: ContextUsageIndicatorProps) {
  const [hovered, setHovered] = useState(false)

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

  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens
  const cache = usage.cache_read_input_tokens ?? 0
  const cacheCreation = usage.cache_creation_input_tokens ?? 0
  const maxContext = 200000
  const ratio = Math.min(inputTokens / maxContext, 1)
  const pct = ratio * 100

  // SVG circle parameters
  const size = 16
  const strokeWidth = 2.5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - ratio * circumference

  let strokeColor = 'text-zinc-600 dark:text-zinc-400'
  if (pct > 80) strokeColor = 'text-status-error-foreground'
  else if (pct > 60) strokeColor = 'text-status-warning-foreground'

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Circular ring */}
      <button type="button" className="p-1 rounded hover:bg-muted transition-colors">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-muted"
          />
          {/* Usage arc */}
          {ratio > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className={`${strokeColor} transition-all`}
              style={{ stroke: 'currentColor' }}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
        </svg>
      </button>

      {/* Hover detail card */}
      {hovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 p-3 text-xs rounded-md bg-popover border border-border shadow-md z-50">
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">已使用</span>
              <span className="font-medium">{formatTokens(inputTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">上下文窗口</span>
              <span className="font-medium">{formatTokens(maxContext)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">使用率</span>
              <span className="font-medium">{pct.toFixed(1)}%</span>
            </div>
            <div className="border-t border-border pt-1.5 mt-1.5 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">缓存读取</span>
                <span>{formatTokens(cache)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">缓存创建</span>
                <span>{formatTokens(cacheCreation)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">输出 tokens</span>
                <span>{formatTokens(outputTokens)}</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
              基于最新消息的 token 统计估算
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
