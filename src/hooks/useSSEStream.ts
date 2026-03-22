/**
 * useSSEStream — SSE stream consumption hook for chat messages.
 * Connects to the sidecar's POST /chat endpoint and parses SSE events.
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

interface UseSSEStreamResult {
  messages: StreamMessage[]
  streamingText: string
  isStreaming: boolean
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
  const abortRef = useRef<AbortController | null>(null)

  const clear = useCallback(() => {
    setMessages([])
    setStreamingText('')
  }, [])

  const send = useCallback(
    async (
      baseUrl: string,
      sessionId: string,
      content: string,
      options?: { model?: string; mode?: string; providerId?: string },
    ) => {
      // Abort previous stream if any
      if (abortRef.current) {
        abortRef.current.abort()
      }

      const abort = new AbortController()
      abortRef.current = abort

      setIsStreaming(true)
      setStreamingText('')

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
        let accumulatedText = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6)) as StreamMessage

                if (event.type === 'text' && typeof event.data === 'string') {
                  accumulatedText += event.data
                  setStreamingText(accumulatedText)
                } else if (event.type === 'done') {
                  // Stream complete
                } else {
                  setMessages((prev) => [...prev, event])
                }
              } catch {
                // ignore malformed SSE
              }
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
    // Abort the fetch
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    // Also notify the sidecar
    fetch(`${baseUrl}/chat/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {})
    setIsStreaming(false)
  }, [])

  return { messages, streamingText, isStreaming, send, interrupt, clear }
}
