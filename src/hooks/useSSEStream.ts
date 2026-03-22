/**
 * useSSEStream — Event Bus SSE stream consumption hook.
 *
 * Architecture change: instead of holding a long-lived HTTP response from
 * POST /chat, we now:
 *   1. POST /chat (fire-and-forget) — starts the conversation in sidecar
 *   2. GET /chat/events/:sessionId (SSE) — subscribe to buffered events
 *
 * The sidecar buffers all events in memory. If the SSE connection drops
 * (e.g. App Nap, WebView throttle), the hook reconnects with ?after=N
 * to replay missed events. The conversation itself is never interrupted.
 */

import { useState, useCallback, useRef } from 'react'

export interface StreamMessage {
  type:
    | 'text'
    | 'thinking'
    | 'tool_use'
    | 'tool_result'
    | 'tool_output'
    | 'tool_timeout'
    | 'permission_request'
    | 'mode_change'
    | 'task_update'
    | 'keep_alive'
    | 'rewind_point'
    | 'error'
    | 'status'
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
  thinkingText: string
  isThinking: boolean
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
      systemPromptAppend?: string
    },
  ) => void
  interrupt: (baseUrl: string, sessionId: string) => void
  clear: () => void
}

const MAX_RECONNECT = 10
const BASE_DELAY_MS = 1000

export function useSSEStream(): UseSSEStreamResult {
  const [messages, setMessages] = useState<StreamMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [thinkingText, setThinkingText] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>([])
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>([])
  const [statusText, setStatusText] = useState('')
  const [streamingToolOutput, setStreamingToolOutput] = useState('')

  // Mutable refs for the SSE loop (text accumulation must survive reconnects)
  const abortRef = useRef<AbortController | null>(null)
  const textRef = useRef('')
  const thinkingRef = useRef('')
  const lastIndexRef = useRef(-1)

  const clear = useCallback(() => {
    setMessages([])
    setStreamingText('')
    setThinkingText('')
    setIsThinking(false)
    setToolUses([])
    setToolResults([])
    setStatusText('')
    setStreamingToolOutput('')
    textRef.current = ''
    thinkingRef.current = ''
    lastIndexRef.current = -1
  }, [])

  const send = useCallback(
    async (
      baseUrl: string,
      sessionId: string,
      content: string,
      options?: { model?: string; mode?: string; providerId?: string; systemPromptAppend?: string },
    ) => {
      // Abort any previous SSE connection
      if (abortRef.current) {
        abortRef.current.abort()
      }

      const abort = new AbortController()
      abortRef.current = abort

      setIsStreaming(true)
      setStreamingText('')
      setThinkingText('')
      setIsThinking(false)
      setToolUses([])
      setToolResults([])
      setStatusText('')
      setStreamingToolOutput('')
      textRef.current = ''
      thinkingRef.current = ''
      lastIndexRef.current = -1

      try {
        // Step 1: Fire-and-forget POST to start the conversation
        const postRes = await fetch(`${baseUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            content,
            model: options?.model,
            mode: options?.mode,
            provider_id: options?.providerId,
            systemPromptAppend: options?.systemPromptAppend,
          }),
          signal: abort.signal,
        })

        if (!postRes.ok) {
          const err = await postRes.json().catch(() => ({ error: 'Request failed' }))
          setMessages((prev) => [...prev, { type: 'error', data: err.error || 'Request failed' }])
          setIsStreaming(false)
          return
        }

        // Step 2: Subscribe to SSE events with auto-reconnect
        await subscribeWithReconnect(baseUrl, sessionId, abort)
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

  /**
   * Subscribe to GET /chat/events/:sessionId with exponential backoff reconnect.
   * On reconnect, passes ?after=lastIndex to replay missed events.
   */
  async function subscribeWithReconnect(
    baseUrl: string,
    sessionId: string,
    abort: AbortController,
  ): Promise<void> {
    let attempt = 0

    while (attempt < MAX_RECONNECT && !abort.signal.aborted) {
      try {
        const afterParam = lastIndexRef.current >= 0 ? `?after=${lastIndexRef.current}` : ''
        const url = `${baseUrl}/chat/events/${sessionId}${afterParam}`

        const res = await fetch(url, {
          headers: { Accept: 'text/event-stream' },
          signal: abort.signal,
        })

        if (!res.ok || !res.body) {
          throw new Error(`SSE connect failed: ${res.status}`)
        }

        // Reset reconnect counter on successful connection
        attempt = 0

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let done = false

        while (!done) {
          const result = await reader.read()
          if (result.done) break

          buffer += decoder.decode(result.value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as {
                type: string
                data: unknown
                index: number
              }

              // Track cursor for reconnect
              if (event.index != null) {
                lastIndexRef.current = event.index
              }

              // Dispatch event
              done = handleEvent(event)
              if (done) return // 'done' event — conversation complete
            } catch {
              // malformed SSE line
            }
          }
        }

        // If reader.read() returned done without a 'done' event,
        // the connection was closed unexpectedly — reconnect
        if (!done && !abort.signal.aborted) {
          throw new Error('SSE connection closed unexpectedly')
        }
        return
      } catch (err) {
        if (abort.signal.aborted) return
        if ((err as Error).name === 'AbortError') return

        attempt++
        if (attempt >= MAX_RECONNECT) {
          setMessages((prev) => [
            ...prev,
            { type: 'error', data: 'Lost connection to server after multiple retries' },
          ])
          return
        }

        // Exponential backoff: 1s, 2s, 4s, 8s...
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }

  /**
   * Process a single SSE event. Returns true when the stream is complete ('done').
   */
  function handleEvent(event: { type: string; data: unknown; index: number }): boolean {
    switch (event.type) {
      case 'thinking': {
        thinkingRef.current += event.data
        setThinkingText(thinkingRef.current)
        setIsThinking(true)
        break
      }

      case 'text': {
        if (thinkingRef.current) setIsThinking(false)
        textRef.current += event.data
        setStreamingText(textRef.current)
        break
      }

      case 'tool_use': {
        try {
          const d = JSON.parse(event.data as string)
          setToolUses((prev) => {
            if (prev.some((t) => t.id === d.id)) return prev
            return [...prev, { id: d.id, name: d.name, input: d.input }]
          })
          setStreamingToolOutput('')
        } catch {
          // skip malformed
        }
        break
      }

      case 'tool_result': {
        try {
          const d = JSON.parse(event.data as string)
          setToolResults((prev) => {
            const idx = prev.findIndex((r) => r.tool_use_id === d.tool_use_id)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = {
                tool_use_id: d.tool_use_id,
                content: d.content,
                is_error: d.is_error,
              }
              return next
            }
            return [
              ...prev,
              { tool_use_id: d.tool_use_id, content: d.content, is_error: d.is_error },
            ]
          })
          setStreamingToolOutput('')
        } catch {
          // skip malformed
        }
        break
      }

      case 'tool_output': {
        try {
          const parsed = JSON.parse(event.data as string)
          if (parsed._progress) {
            const elapsed = Math.round(parsed.elapsed_time_seconds ?? 0)
            setStatusText(`Running ${parsed.tool_name || 'tool'}... (${elapsed}s)`)
            break
          }
        } catch {
          // Not JSON — raw stderr
        }
        setStreamingToolOutput((prev) => {
          const next = prev + (prev ? '\n' : '') + (event.data as string)
          return next.length > 5000 ? next.slice(-5000) : next
        })
        break
      }

      case 'status': {
        try {
          const d = JSON.parse(event.data as string)
          if (d.session_id) {
            const modelName = d.requested_model || d.model || 'claude'
            setStatusText(`Connected (${modelName})`)
            setTimeout(() => setStatusText(''), 2000)
          } else if (d.notification) {
            setStatusText(d.message || d.title || '')
          } else {
            setStatusText(typeof event.data === 'string' ? (event.data as string) : '')
          }
        } catch {
          setStatusText((event.data as string) || '')
        }
        break
      }

      case 'result': {
        setMessages((prev) => [...prev, { type: 'result', data: event.data }])
        setStatusText('')
        break
      }

      case 'error': {
        textRef.current += '\n\n**Error:** ' + (event.data as string)
        setStreamingText(textRef.current)
        setMessages((prev) => [...prev, { type: 'error', data: event.data }])
        break
      }

      case 'permission_request': {
        setMessages((prev) => [...prev, { type: 'permission_request', data: event.data }])
        break
      }

      case 'tool_timeout': {
        try {
          const parsed = JSON.parse(event.data as string)
          const elapsed = Math.round(parsed.elapsed_time_seconds ?? 0)
          setStatusText(`${parsed.tool_name || 'Tool'} timed out (${elapsed}s)`)
        } catch {
          setStatusText('Tool execution timed out')
        }
        break
      }

      case 'mode_change': {
        try {
          const parsed = JSON.parse(event.data as string)
          setStatusText(`Mode: ${parsed.mode || event.data}`)
          setTimeout(() => setStatusText(''), 3000)
        } catch {
          setStatusText(`Mode: ${event.data}`)
          setTimeout(() => setStatusText(''), 3000)
        }
        break
      }

      case 'task_update': {
        window.dispatchEvent(new CustomEvent('tasks-updated'))
        break
      }

      case 'keep_alive':
        break

      case 'rewind_point':
        setMessages((prev) => [...prev, { type: 'rewind_point', data: event.data }])
        break

      case 'done':
        return true

      default:
        setMessages((prev) => [
          ...prev,
          { type: event.type as StreamMessage['type'], data: event.data },
        ])
        break
    }

    return false
  }

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
    thinkingText,
    isThinking,
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
