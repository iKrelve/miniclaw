/**
 * MessageList — Renders chat messages with auto-scroll, tool calls, streaming,
 * permission prompts, and error display.
 *
 * Uses Conversation (use-stick-to-bottom) for smart auto-scroll,
 * MessageItem for persisted messages, and StreamingMessage for in-progress content.
 */

import { useRef, useEffect, useMemo } from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from '../ai-elements/conversation'
import { MessageItem } from './MessageItem'
import { StreamingMessage } from './StreamingMessage'
import { PermissionPrompt } from './PermissionPrompt'
import type { ToolUseInfo, ToolResultInfo, StreamMessage } from '../../hooks/useSSEStream'
import logo from '../../assets/logo.png'

/**
 * Scrolls to bottom when streaming starts or new messages arrive.
 * Must be rendered inside <Conversation> (StickToBottom provider).
 */
function ScrollOnStream({ isStreaming, count }: { isStreaming: boolean; count: number }) {
  const { scrollToBottom } = useStickToBottomContext()
  const wasStreaming = useRef(false)
  const prevCount = useRef(count)

  useEffect(() => {
    if (count > prevCount.current) scrollToBottom()
    prevCount.current = count
  }, [count, scrollToBottom])

  useEffect(() => {
    if (isStreaming && !wasStreaming.current) scrollToBottom()
    wasStreaming.current = isStreaming
  }, [isStreaming, scrollToBottom])

  return null
}

interface Message {
  id: string
  role: string
  content: string
  created_at?: string
}

interface MessageListProps {
  messages: Message[]
  streamingContent: string
  isStreaming: boolean
  toolUses?: ToolUseInfo[]
  toolResults?: ToolResultInfo[]
  streamingToolOutput?: string
  statusText?: string
  streamEvents?: StreamMessage[]
  onForceStop?: () => void
  onPermissionAllow?: (id: string) => void
  onPermissionDeny?: (id: string) => void
}

export function MessageList({
  messages,
  streamingContent,
  isStreaming,
  toolUses = [],
  toolResults = [],
  streamingToolOutput,
  statusText,
  streamEvents = [],
  onForceStop,
  onPermissionAllow,
  onPermissionDeny,
}: MessageListProps) {
  // Extract permission requests from stream events
  const permissionRequests = useMemo(() => {
    const reqs: Array<{ id: string; tool_name: string; description: string; input: unknown }> = []
    for (const e of streamEvents) {
      if (e.type === 'permission_request') {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
        reqs.push(data as { id: string; tool_name: string; description: string; input: unknown })
      }
    }
    return reqs
  }, [streamEvents])

  // Extract errors from stream events
  const errors = useMemo(() => {
    const errs: string[] = []
    for (const e of streamEvents) {
      if (e.type === 'error') {
        errs.push(typeof e.data === 'string' ? e.data : JSON.stringify(e.data))
      }
    }
    return errs
  }, [streamEvents])

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ConversationEmptyState
          title="小龙虾"
          description="输入消息开始新对话"
          icon={<img src={logo} alt="小龙虾" className="w-16 h-16" />}
        />
      </div>
    )
  }

  return (
    <Conversation>
      <ScrollOnStream isStreaming={isStreaming} count={messages.length} />
      <ConversationContent className="mx-auto max-w-3xl px-4 py-6 gap-6">
        {messages.map((msg) => (
          <div key={msg.id} id={`msg-${msg.id}`} className="group">
            <MessageItem message={msg} />
          </div>
        ))}

        {/* Permission requests */}
        {permissionRequests.map((pr) => (
          <div key={pr.id} className="max-w-3xl">
            <PermissionPrompt
              request={pr}
              onAllow={onPermissionAllow || (() => {})}
              onDeny={onPermissionDeny || (() => {})}
            />
          </div>
        ))}

        {/* Streaming assistant message */}
        {isStreaming && (
          <StreamingMessage
            content={streamingContent}
            isStreaming={isStreaming}
            toolUses={toolUses}
            toolResults={toolResults}
            streamingToolOutput={streamingToolOutput}
            statusText={statusText}
            onForceStop={onForceStop}
          />
        )}

        {/* Error messages */}
        {errors.map((err, i) => (
          <div
            key={`err-${i}`}
            className="max-w-3xl rounded-lg px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm"
          >
            <span className="font-medium">错误：</span>
            {err}
          </div>
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
