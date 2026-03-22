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

interface Message_ {
  id: string
  role: string
  content: string
  created_at?: string
}

// ---------------------------------------------------------------------------
// Tool block parsing (from content JSON array)
// ---------------------------------------------------------------------------

interface ToolBlock {
  type: 'tool_use' | 'tool_result'
  id?: string
  name?: string
  input?: unknown
  content?: string
  is_error?: boolean
}

function parseToolBlocks(content: string): { text: string; tools: ToolBlock[] } {
  const tools: ToolBlock[] = []
  let text = ''

  // Try JSON array format (SDK structured content)
  if (content.startsWith('[')) {
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

      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          text += block.text
        } else if (block.type === 'tool_use') {
          tools.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
        } else if (block.type === 'tool_result') {
          tools.push({
            type: 'tool_result',
            id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          })
        }
      }

      return { text: text.trim(), tools }
    } catch {
      // Not valid JSON, fall through
    }
  }

  return { text: content.trim(), tools: [] }
}

function pairTools(
  tools: ToolBlock[],
): Array<{ name: string; input: unknown; result?: string; isError?: boolean }> {
  const paired: Array<{ name: string; input: unknown; result?: string; isError?: boolean }> = []

  const resultMap = new Map<string, ToolBlock>()
  for (const t of tools) {
    if (t.type === 'tool_result' && t.id) resultMap.set(t.id, t)
  }

  for (const t of tools) {
    if (t.type === 'tool_use' && t.name) {
      const result = t.id ? resultMap.get(t.id) : undefined
      paired.push({
        name: t.name,
        input: t.input,
        result: result?.content,
        isError: result?.is_error,
      })
    }
  }

  // Orphan results without matching tool_use
  for (const t of tools) {
    if (t.type === 'tool_result' && !tools.some((u) => u.type === 'tool_use' && u.id === t.id)) {
      paired.push({ name: 'tool_result', input: {}, result: t.content, isError: t.is_error })
    }
  }

  return paired
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
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      title="Copy"
    >
      {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
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

  // Parse tool blocks
  const { text, pairedTools } = useMemo(() => {
    const { text, tools } = parseToolBlocks(message.content)
    return { text, pairedTools: pairTools(tools) }
  }, [message.content])

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
        {/* Tool calls for assistant messages */}
        {!isUser && pairedTools.length > 0 && (
          <ToolActionsGroup
            tools={pairedTools.map((tool, i) => ({
              id: `hist-${i}`,
              name: tool.name,
              input: tool.input,
              result: tool.result,
              isError: tool.isError,
            }))}
          />
        )}

        {/* Text content */}
        {text &&
          (isUser ? (
            <div className="relative">
              <div
                ref={contentRef}
                className="text-sm whitespace-pre-wrap break-words transition-[max-height] duration-300 ease-in-out overflow-hidden"
                style={overflowing && !expanded ? { maxHeight: `${COLLAPSE_HEIGHT}px` } : undefined}
              >
                {text}
              </div>
              {overflowing && !expanded && (
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-blue-500 to-transparent pointer-events-none" />
              )}
              {overflowing && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="relative z-10 flex items-center gap-1 mt-1 text-xs text-white/70 hover:text-white h-auto px-1 py-0.5"
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
          ) : (
            <MessageResponse>{text}</MessageResponse>
          ))}
      </MessageContent>

      {/* Footer — timestamp + copy (hover to show) */}
      <div
        className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'justify-end' : ''}`}
      >
        {!isUser && timestamp && <span className="text-xs text-zinc-400/60">{timestamp}</span>}
        {text && <CopyButton text={text} />}
      </div>
    </Message>
  )
})
