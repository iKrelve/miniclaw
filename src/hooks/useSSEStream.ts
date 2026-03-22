/**
 * useSSEStream — SSE stream consumption hook for chat messages.
 * Connects to the sidecar's POST /chat endpoint and parses SSE events.
 *
 * Separates tool_use / tool_result / status events for structured rendering.
 */

import { useState, useCallback, useRef } from 'react'

export interface StreamMessage {
  type:
    | 'text'
    | 'tool_use'
    | 'tool_result'
    | 'permission_request'
    | 'error'
    | 'status'
    | 'tool_output'
    | 'result'
    | 'done'
  data: unknown
}

export interface ToolUseInfo {
  id: string
  name: string
  input: unknown
}

export interface ToolResultInfo {
  tool_use_id: string
  content: string
  is_error?: boolean
}

interface UseSSEStreamResult {
  messages: StreamMessage[]
  streamingText: string
  isStreaming: boolean
  toolUses: ToolUseInfo[]
  toolResults: ToolResultInfo[]
  statusText: string
  streamingToolOutput: string
  send: (
    baseUrl: string,
    sessionId: string,
    content: string,
    options?: {
      model?: string
      mode?: string
      providerId?: string
    },
  ) => void
  interrupt: (baseUrl: string, sessionId: string) => void
  clear: () => void
}

export function useSSEStream(): UseSSEStreamResult {
  const [messages, setMessages] = useState<StreamMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>([])
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>([])
  const [statusText, setStatusText] = useState('')
  const [streamingToolOutput, setStreamingToolOutput] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const clear = useCallback(() => {
    setMessages([])
    setStreamingText('')
    setToolUses([])
    setToolResults([])
    setStatusText('')
    setStreamingToolOutput('')
  }, [])

  const send = useCallback(
    async (
      baseUrl: string,
      sessionId: string,
      content: string,
      options?: { model?: string; mode?: string; providerId?: string },
    ) => {
      // Abort previous stream
      if (abortRef.current) {
        abortRef.current.abort()
      }

      const abort = new AbortController()
      abortRef.current = abort

      setIsStreaming(true)
      setStreamingText('')
      setToolUses([])
      setToolResults([])
      setStatusText('')
      setStreamingToolOutput('')

      try {
        const res = await fetch(`${baseUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            content,
            model: options?.model,
            mode: options?.mode,
            provider_id: options?.providerId,
          }),
          signal: abort.signal,
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }))
          setMessages((prev) => [...prev, { type: 'error', data: err.error || 'Request failed' }])
          setIsStreaming(false)
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          setIsStreaming(false)
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''
        let text = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as StreamMessage

              switch (event.type) {
                case 'text':
                  if (typeof event.data === 'string') {
                    text += event.data
                    setStreamingText(text)
                  }
                  break

                case 'tool_use': {
                  const tu = event.data as ToolUseInfo
                  setToolUses((prev) => [...prev, tu])
                  break
                }

                case 'tool_result': {
                  const tr = event.data as ToolResultInfo
                  setToolResults((prev) => [...prev, tr])
                  break
                }

                case 'status':
                  if (typeof event.data === 'string') {
                    setStatusText(event.data)
                  }
                  break

                case 'tool_output':
                  if (typeof event.data === 'string') {
                    setStreamingToolOutput((prev) => prev + event.data)
                  }
                  break

                case 'done':
                  // Stream complete — handled by finally block
                  break

                default:
                  setMessages((prev) => [...prev, event])
                  break
              }
            } catch {
              // ignore malformed SSE
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setMessages((prev) => [
            ...prev,
            { type: 'error', data: (err as Error).message || 'Stream error' },
          ])
        }
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [],
  )

  const interrupt = useCallback((baseUrl: string, sessionId: string) => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    fetch(`${baseUrl}/chat/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {})
    setIsStreaming(false)
  }, [])

  return {
    messages,
    streamingText,
    isStreaming,
    toolUses,
    toolResults,
    statusText,
    streamingToolOutput,
    send,
    interrupt,
    clear,
  }
}
