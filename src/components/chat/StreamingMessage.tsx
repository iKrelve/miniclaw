/**
 * StreamingMessage — renders the assistant's in-progress response.
 *
 * Includes: tool actions group, streaming Markdown text,
 * thinking phase label, and status bar with elapsed timer.
 */

import { useState, useEffect, useRef } from 'react'
import { Message, MessageContent, MessageResponse } from '../ai-elements/message'
import { ToolActionsGroup } from '../ai-elements/tool-actions-group'
import { Shimmer } from '../ai-elements/shimmer'
import { WidgetRenderer } from './WidgetRenderer'
import { parseAllShowWidgets, computePartialWidgetKey } from '../../lib/widget-parser'
import type { ToolUseInfo, ToolResultInfo } from '../../hooks/useSSEStream'

// ---------------------------------------------------------------------------
// ThinkingPhaseLabel — evolves over time to reduce perceived wait
// ---------------------------------------------------------------------------

function ThinkingPhaseLabel() {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 5000)
    const t2 = setTimeout(() => setPhase(2), 15000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  const text = phase === 0 ? '思考中...' : phase === 1 ? '深度思考中...' : '组织回复中...'

  return <Shimmer>{text}</Shimmer>
}

// ---------------------------------------------------------------------------
// ElapsedTimer
// ---------------------------------------------------------------------------

function ElapsedTimer() {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(0)

  useEffect(() => {
    startRef.current = Date.now()
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60

  return <span className="tabular-nums">{mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}</span>
}

// ---------------------------------------------------------------------------
// StreamingStatusBar
// ---------------------------------------------------------------------------

function StreamingStatusBar({
  statusText,
  onForceStop,
}: {
  statusText?: string
  onForceStop?: () => void
}) {
  const display = statusText || '思考中'

  // Parse elapsed from statusText like "Running bash... (45s)"
  const match = statusText?.match(/\((\d+)s\)/)
  const toolElapsed = match ? parseInt(match[1], 10) : 0
  const isWarning = toolElapsed >= 60
  const isCritical = toolElapsed >= 90

  return (
    <div className="flex items-center gap-3 py-2 px-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span
          className={
            isCritical
              ? 'text-status-error-foreground'
              : isWarning
                ? 'text-status-warning-foreground'
                : undefined
          }
        >
          <Shimmer duration={1.5}>{display}</Shimmer>
        </span>
        {isWarning && !isCritical && (
          <span className="text-status-warning-foreground text-[10px]">运行时间较长</span>
        )}
        {isCritical && (
          <span className="text-status-error-foreground text-[10px]">工具可能已卡住</span>
        )}
      </div>
      <span className="text-muted-foreground/50">|</span>
      <ElapsedTimer />
      {isCritical && onForceStop && (
        <button
          type="button"
          onClick={onForceStop}
          className="ml-auto border border-status-error-border bg-status-error-muted text-[10px] font-medium text-status-error-foreground px-2 py-0.5 rounded hover:bg-status-error-muted transition-colors"
        >
          强制停止
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// StreamingMessage
// ---------------------------------------------------------------------------

interface StreamingMessageProps {
  content: string
  isStreaming: boolean
  toolUses?: ToolUseInfo[]
  toolResults?: ToolResultInfo[]
  streamingToolOutput?: string
  statusText?: string
  onForceStop?: () => void
}

// ── Widget-aware streaming content renderer ────────────────────────────

function renderStreamingContent(content: string, streaming: boolean) {
  const hasWidgetFence = /```show-widget/.test(content)

  if (hasWidgetFence && streaming) {
    const lastFenceStart = content.lastIndexOf('```show-widget')
    const afterLastFence = content.slice(lastFenceStart)
    const lastFenceClosed = /```show-widget\s*\n?[\s\S]*?\n?\s*```/.test(afterLastFence)

    if (lastFenceClosed) {
      const allSegments = parseAllShowWidgets(content)
      return (
        <>
          {allSegments.map((seg, i) =>
            seg.type === 'text' ? (
              <MessageResponse key={`t-${i}`}>{seg.content}</MessageResponse>
            ) : (
              <WidgetRenderer
                key={`w-${i}`}
                widgetCode={seg.data.widget_code}
                isStreaming={false}
                title={seg.data.title}
              />
            ),
          )}
        </>
      )
    }

    // Last fence still open — render completed + partial
    const beforePart = content.slice(0, lastFenceStart).trim()
    const hasCompletedFences = beforePart.length > 0 && /```show-widget/.test(beforePart)
    const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : []

    // Extract partial widget code
    const fenceBody = content.slice(lastFenceStart + '```show-widget'.length).trim()
    let partialCode: string | null = null
    const keyIdx = fenceBody.indexOf('"widget_code"')
    if (keyIdx !== -1) {
      const colonIdx = fenceBody.indexOf(':', keyIdx + 13)
      if (colonIdx !== -1) {
        const quoteIdx = fenceBody.indexOf('"', colonIdx + 1)
        if (quoteIdx !== -1) {
          let raw = fenceBody.slice(quoteIdx + 1)
          raw = raw.replace(/"\s*\}\s*$/, '')
          if (raw.endsWith('\\')) raw = raw.slice(0, -1)
          try {
            partialCode = raw
              .replace(/\\\\/g, '\x00BACKSLASH\x00')
              .replace(/\\n/g, '\n')
              .replace(/\\t/g, '\t')
              .replace(/\\r/g, '\r')
              .replace(/\\"/g, '"')
              .replace(/\x00BACKSLASH\x00/g, '\\')
          } catch {
            partialCode = null
          }
        }
      }
    }

    // Truncate unclosed <script>
    let scriptsTruncated = false
    if (partialCode) {
      const lastScript = partialCode.lastIndexOf('<script')
      if (lastScript !== -1) {
        const afterScript = partialCode.slice(lastScript)
        if (!/<script[\s\S]*?<\/script>/i.test(afterScript)) {
          partialCode = partialCode.slice(0, lastScript).trim() || null
          scriptsTruncated = true
        }
      }
    }

    let partialTitle: string | undefined
    const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/)
    if (titleMatch) partialTitle = titleMatch[1]
    const partialWidgetKey = computePartialWidgetKey(content)

    return (
      <>
        {!hasCompletedFences && beforePart && (
          <MessageResponse key="pre-text">{beforePart}</MessageResponse>
        )}
        {completedSegments.map((seg, i) =>
          seg.type === 'text' ? (
            <MessageResponse key={`t-${i}`}>{seg.content}</MessageResponse>
          ) : (
            <WidgetRenderer
              key={`w-${i}`}
              widgetCode={seg.data.widget_code}
              isStreaming={false}
              title={seg.data.title}
            />
          ),
        )}
        {partialCode && partialCode.length > 10 ? (
          <WidgetRenderer
            key={partialWidgetKey}
            widgetCode={partialCode}
            isStreaming
            title={partialTitle}
            showOverlay={scriptsTruncated}
          />
        ) : (
          <Shimmer>加载 Widget...</Shimmer>
        )}
      </>
    )
  }

  if (hasWidgetFence && !streaming) {
    const widgetSegments = parseAllShowWidgets(content)
    if (widgetSegments.length > 0) {
      return (
        <>
          {widgetSegments.map((seg, i) =>
            seg.type === 'text' ? (
              <MessageResponse key={`t-${i}`}>{seg.content}</MessageResponse>
            ) : (
              <WidgetRenderer
                key={`w-${i}`}
                widgetCode={seg.data.widget_code}
                isStreaming={false}
                title={seg.data.title}
              />
            ),
          )}
        </>
      )
    }
  }

  // Strip partial widget fences during streaming
  if (streaming) {
    const stripped = content.replace(/```show-widget[\s\S]*$/, '').trim()
    return stripped ? <MessageResponse>{stripped}</MessageResponse> : null
  }

  const stripped = content.replace(/```show-widget[\s\S]*?(```|$)/g, '').trim()
  return stripped ? <MessageResponse>{stripped}</MessageResponse> : null
}

export function StreamingMessage({
  content,
  isStreaming,
  toolUses = [],
  toolResults = [],
  streamingToolOutput,
  statusText,
  onForceStop,
}: StreamingMessageProps) {
  const runningTools = toolUses.filter(
    (tool) => !toolResults.some((r) => r.tool_use_id === tool.id),
  )

  // Build a human-readable summary of the running command
  const getRunningCommandSummary = (): string | undefined => {
    if (runningTools.length === 0) {
      if (toolUses.length > 0) return '生成回复中...'
      return undefined
    }
    const tool = runningTools[runningTools.length - 1]
    const input = tool.input as Record<string, unknown>
    if (tool.name === 'Bash' && input.command) {
      const cmd = String(input.command)
      return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd
    }
    if (input.file_path) return `${tool.name}: ${String(input.file_path)}`
    if (input.path) return `${tool.name}: ${String(input.path)}`
    return `执行 ${tool.name}...`
  }

  return (
    <Message from="assistant">
      <MessageContent>
        {/* Tool calls — compact collapsible group */}
        {toolUses.length > 0 && (
          <ToolActionsGroup
            tools={toolUses.map((tool) => {
              const result = toolResults.find((r) => r.tool_use_id === tool.id)
              return {
                id: tool.id,
                name: tool.name,
                input: tool.input,
                result: result?.content,
                isError: result?.is_error,
              }
            })}
            isStreaming={isStreaming}
            streamingToolOutput={streamingToolOutput}
          />
        )}

        {/* Streaming text content — with widget detection */}
        {content && renderStreamingContent(content, isStreaming)}

        {/* Loading indicator when no content yet */}
        {isStreaming && !content && toolUses.length === 0 && (
          <div className="py-2">
            <ThinkingPhaseLabel />
          </div>
        )}

        {/* Status bar during streaming */}
        {isStreaming && (
          <StreamingStatusBar
            statusText={
              statusText ||
              getRunningCommandSummary() ||
              (content && content.length > 0 ? '生成中...' : undefined)
            }
            onForceStop={onForceStop}
          />
        )}
      </MessageContent>
    </Message>
  )
}
