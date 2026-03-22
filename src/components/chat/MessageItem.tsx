/**
 * MessageItem — renders a single persisted message (user or assistant).
 *
 * User messages: collapsible text with blue bubble.
 * Assistant messages: tool actions group + Streamdown Markdown + footer (timestamp, copy).
 */

import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react'
import { Copy, Check, CaretDown, CaretUp } from '@phosphor-icons/react'
import { Message, MessageContent, MessageResponse } from '../ai-elements/message'
import { ToolActionsGroup } from '../ai-elements/tool-actions-group'
import { WidgetRenderer } from './WidgetRenderer'
import { parseAllShowWidgets } from '../../lib/widget-parser'
import { FileAttachmentDisplay } from './FileAttachmentDisplay'

interface Message_ {
  id: string
  role: string
  content: string
  created_at?: string
  token_usage?: string
}

// ---------------------------------------------------------------------------
// Content segment parsing — preserves text ↔ tool interleaved order
// ---------------------------------------------------------------------------

interface PairedTool {
  name: string
  input: unknown
  result?: string
  isError?: boolean
}

export type ContentSegment =
  | { kind: 'text'; content: string }
  | { kind: 'tool_group'; tools: PairedTool[] }

/**
 * Parse a persisted assistant message into ordered segments.
 * DB stores a JSON array of `[{text}, {tool_use}, {tool_result}, {text}, ...]`.
 * This function preserves that order and groups consecutive tool_use/tool_result
 * pairs into tool_group segments, with text segments in between.
 */
function parseContentSegments(content: string): { segments: ContentSegment[]; fullText: string } {
  if (!content.startsWith('[')) {
    return { segments: [{ kind: 'text', content: content.trim() }], fullText: content.trim() }
  }

  try {
    const blocks = JSON.parse(content) as Array<{
      type: string
      text?: string
      id?: string
      name?: string
      input?: unknown
      tool_use_id?: string
      content?: string
      is_error?: boolean
    }>

    // Build a result map for pairing tool_use → tool_result
    const resultMap = new Map<string, { content?: string; is_error?: boolean }>()
    for (const b of blocks) {
      if (b.type === 'tool_result' && b.tool_use_id) {
        resultMap.set(b.tool_use_id, { content: b.content, is_error: b.is_error })
      }
    }

    const segments: ContentSegment[] = []
    let textBuf = ''
    let toolBuf: PairedTool[] = []

    const flushText = () => {
      if (textBuf.trim()) {
        segments.push({ kind: 'text', content: textBuf.trim() })
      }
      textBuf = ''
    }
    const flushTools = () => {
      if (toolBuf.length > 0) {
        segments.push({ kind: 'tool_group', tools: [...toolBuf] })
        toolBuf = []
      }
    }

    let fullText = ''

    for (const b of blocks) {
      if (b.type === 'text' && b.text) {
        // Text after tools → flush tools first
        flushTools()
        textBuf += b.text
        fullText += b.text
      } else if (b.type === 'tool_use' && b.name) {
        // Tool after text → flush text first
        flushText()
        const result = b.id ? resultMap.get(b.id) : undefined
        toolBuf.push({
          name: b.name,
          input: b.input,
          result: result?.content,
          isError: result?.is_error,
        })
      }
      // tool_result is consumed via resultMap above, skip standalone
    }

    flushTools()
    flushText()

    return { segments, fullText: fullText.trim() }
  } catch {
    return { segments: [{ kind: 'text', content: content.trim() }], fullText: content.trim() }
  }
}

// ---------------------------------------------------------------------------
// File attachment parsing (<!--files:...-->)
// ---------------------------------------------------------------------------

interface FileAttachment {
  id?: string
  name: string
  type?: string
  size?: number
}

function parseMessageFiles(content: string): { text: string; files: FileAttachment[] } {
  const match = content.match(/^<!--files:(.*?)-->/)
  if (!match) return { text: content, files: [] }
  try {
    const files = JSON.parse(match[1]) as FileAttachment[]
    const text = content.slice(match[0].length).trim()
    return { text, files }
  } catch {
    return { text: content, files: [] }
  }
}

// ---------------------------------------------------------------------------
// Token usage display
// ---------------------------------------------------------------------------

interface TokenUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cost_usd?: number
}

function TokenUsageDisplay({ raw }: { raw: string }) {
  try {
    const usage: TokenUsage = JSON.parse(raw)
    const input = usage.input_tokens ?? 0
    const output = usage.output_tokens ?? 0
    const cache = usage.cache_read_input_tokens ?? 0
    const cost = usage.cost_usd
    if (input === 0 && output === 0) return null

    const total = input + output
    const costStr = cost !== undefined && cost !== null ? ` · $${cost.toFixed(4)}` : ''

    return (
      <span className="group/tokens relative cursor-default text-[10px] text-muted-foreground/50 tabular-nums">
        <span>
          {total.toLocaleString()} tokens{costStr}
        </span>
        {/* Hover tooltip with detailed breakdown */}
        <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md border border-border/50 opacity-0 group-hover/tokens:opacity-100 transition-opacity duration-150 z-50">
          In: {input.toLocaleString()} · Out: {output.toLocaleString()}
          {cache > 0 ? ` · Cache: ${cache.toLocaleString()}` : ''}
          {costStr}
        </span>
      </span>
    )
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handle = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }, [text])

  return (
    <button
      type="button"
      onClick={handle}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check size={12} className="text-status-success-foreground" /> : <Copy size={12} />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// MessageItem
// ---------------------------------------------------------------------------

const COLLAPSE_HEIGHT = 300

interface MessageItemProps {
  message: Message_
}

export const MessageItem = memo(function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user'

  // Collapse/expand for long user messages
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Parse content into ordered segments (text ↔ tool interleaved)
  const {
    segments,
    fullText: text,
    files,
  } = useMemo(() => {
    if (isUser) {
      const { text, files } = parseMessageFiles(message.content)
      return { segments: [] as ContentSegment[], fullText: text, files }
    }
    const { segments, fullText } = parseContentSegments(message.content)
    return { segments, fullText, files: [] as FileAttachment[] }
  }, [message.content, isUser])

  useEffect(() => {
    if (isUser && contentRef.current) {
      setOverflowing(contentRef.current.scrollHeight > COLLAPSE_HEIGHT)
    }
  }, [isUser, text])

  const timestamp = message.created_at
    ? new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <Message from={isUser ? 'user' : 'assistant'}>
      <MessageContent>
        {/* File attachments for user messages */}
        {isUser && files.length > 0 && <FileAttachmentDisplay files={files} />}

        {/* Assistant messages: interleaved text ↔ tool groups */}
        {!isUser &&
          segments.length > 0 &&
          segments.map((seg, i) =>
            seg.kind === 'tool_group' ? (
              <ToolActionsGroup
                key={`seg-${i}`}
                tools={seg.tools.map((tool, j) => ({
                  id: `hist-${i}-${j}`,
                  name: tool.name,
                  input: tool.input,
                  result: tool.result,
                  isError: tool.isError,
                }))}
              />
            ) : (
              <AssistantTextContent key={`seg-${i}`} text={seg.content} />
            ),
          )}

        {/* User text content */}
        {isUser && text && (
          <div className="relative">
            <div
              ref={contentRef}
              className="text-sm whitespace-pre-wrap break-words transition-[max-height] duration-300 ease-in-out overflow-hidden"
              style={overflowing && !expanded ? { maxHeight: `${COLLAPSE_HEIGHT}px` } : undefined}
            >
              {text}
            </div>
            {overflowing && !expanded && (
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-secondary to-transparent pointer-events-none" />
            )}
            {overflowing && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="relative z-10 flex items-center gap-1 mt-1 text-xs text-muted-foreground hover:text-foreground h-auto px-1 py-0.5"
              >
                {expanded ? (
                  <>
                    <CaretUp size={12} />
                    <span>收起</span>
                  </>
                ) : (
                  <>
                    <CaretDown size={12} />
                    <span>展开</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </MessageContent>

      {/* Footer — timestamp + token usage + copy (hover to show) */}
      <div
        className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'justify-end' : ''}`}
      >
        {!isUser && timestamp && (
          <span className="text-xs text-muted-foreground/50">{timestamp}</span>
        )}
        {!isUser && message.token_usage && <TokenUsageDisplay raw={message.token_usage} />}
        {text && <CopyButton text={text} />}
      </div>
    </Message>
  )
})

// ── AssistantTextContent — handles show-widget blocks ───────────────────

const AssistantTextContent = memo(function AssistantTextContent({ text }: { text: string }) {
  // Try show-widget first (Generative UI)
  const widgetSegments = parseAllShowWidgets(text)
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

  // Strip any show-widget remnants
  const stripped = text.replace(/```show-widget[\s\S]*?(```|$)/g, '').trim()
  return stripped ? <MessageResponse>{stripped}</MessageResponse> : null
})
