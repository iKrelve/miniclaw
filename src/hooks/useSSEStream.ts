/**
 * useSSEStream — Session-scoped streaming hook with automatic lifecycle.
 *
 * Takes `baseUrl` and `sessionId` as parameters. When `sessionId` changes,
 * the hook automatically:
 *   1. Aborts any active SSE connection
 *   2. Resets all streaming state
 *   3. Fetches persisted messages for the new session
 *   4. If the session is still running, subscribes to its SSE event stream
 *
 * This eliminates the need for manual `clear()`, `skipNextClearRef`, or
 * separate useEffects in ChatView for session-switch coordination.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { Message, FileAttachment } from '@shared/types'

// ==========================================
// Types
// ==========================================

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

/** Ordered segment for interleaved text ↔ tool rendering during streaming */
export type StreamSegment =
  | { kind: 'text'; content: string }
  | {
      kind: 'tool_group'
      tools: Array<{ id: string; name: string; input: unknown; result?: string; isError?: boolean }>
    }

export interface UseSSEStreamResult {
  /** Persisted messages from DB (loaded on session switch) */
  messages: Message[]
  /** Streaming events (permission_request, result, error, etc.) */
  streamEvents: StreamMessage[]
  /** Accumulated assistant text from the active stream */
  streamingText: string
  thinkingText: string
  isThinking: boolean
  isStreaming: boolean
  toolUses: ToolUseInfo[]
  toolResults: ToolResultInfo[]
  statusText: string
  streamingToolOutput: string
  /** Ordered text ↔ tool segments for interleaved rendering */
  streamSegments: StreamSegment[]
  /**
   * Send a message in the current session.
   * For new sessions: call setActiveSession first, then sendNew.
   */
  send: (
    content: string,
    options?: {
      model?: string
      mode?: string
      providerId?: string
      systemPromptAppend?: string
      files?: FileAttachment[]
    },
  ) => void
  /**
   * Send the first message of a just-created session.
   * Accepts explicit targetSessionId because React may not have processed
   * setActiveSession yet when this is called.
   * Skips the usual "fetch messages" step since the session is empty.
   */
  sendNew: (
    targetSessionId: string,
    content: string,
    options?: {
      model?: string
      mode?: string
      providerId?: string
      systemPromptAppend?: string
      files?: FileAttachment[]
    },
  ) => void
  /** Interrupt the active stream */
  interrupt: () => void
}

// ==========================================
// Constants
// ==========================================

const MAX_RECONNECT = 10
const BASE_DELAY_MS = 1000

// ==========================================
// Hook
// ==========================================

export function useSSEStream(baseUrl: string | null, sessionId: string | null): UseSSEStreamResult {
  // ----- Persisted messages (from DB) -----
  const [messages, setMessages] = useState<Message[]>([])

  // ----- Streaming state -----
  const [streamEvents, setStreamEvents] = useState<StreamMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [thinkingText, setThinkingText] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>([])
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>([])
  const [statusText, setStatusText] = useState('')
  const [streamingToolOutput, setStreamingToolOutput] = useState('')
  const [streamSegments, setStreamSegments] = useState<StreamSegment[]>([])

  // ----- Mutable refs -----
  const abortRef = useRef<AbortController | null>(null)
  const textRef = useRef('')
  const thinkingRef = useRef('')
  /** Mutable segment list — updated in-place for performance, then copied to state */
  const segmentsRef = useRef<StreamSegment[]>([])
  /** Accumulated text for the current (trailing) text segment */
  const segTextRef = useRef('')
  const lastIndexRef = useRef(-1)
  const activeSessionRef = useRef<string | null>(null)
  /**
   * When true, the next sessionId change effect skips fetch-messages
   * because sendNew() already has the optimistic message and is managing
   * the SSE connection.
   */
  const skipNextLoadRef = useRef(false)

  // ----- Internal helpers -----

  const abortConnection = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [])

  const resetStreamState = useCallback(() => {
    setStreamEvents([])
    setStreamingText('')
    setThinkingText('')
    setIsThinking(false)
    setIsStreaming(false)
    setToolUses([])
    setToolResults([])
    setStatusText('')
    setStreamingToolOutput('')
    setStreamSegments([])
    textRef.current = ''
    thinkingRef.current = ''
    lastIndexRef.current = -1
    segmentsRef.current = []
    segTextRef.current = ''
  }, [])

  // ==========================================
  // Core effect: react to sessionId changes
  // ==========================================

  useEffect(() => {
    // sendNew() already set up the SSE connection and optimistic message for
    // this session — do NOT abort or reset, just update the ref and bail out.
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false
      activeSessionRef.current = sessionId
      return
    }

    // Abort any active connection when session changes
    abortConnection()
    resetStreamState()
    activeSessionRef.current = sessionId

    // No session → welcome screen
    if (!sessionId) {
      setMessages([])
      return
    }

    if (!baseUrl) return

    // Fetch persisted messages
    setMessages([]) // clear stale data immediately
    fetch(`${baseUrl}/sessions/${sessionId}/messages`)
      .then((res) => res.json())
      .then((data) => {
        // Guard: session may have changed during async fetch
        if (activeSessionRef.current !== sessionId) return
        setMessages(data.messages || [])
      })
      .catch(() => {})

    // Check if session is still running → auto-subscribe to SSE
    fetch(`${baseUrl}/sessions/${sessionId}`)
      .then((res) => res.json())
      .then((data) => {
        if (activeSessionRef.current !== sessionId) return
        if (data.session?.runtime_status === 'running') {
          startSSE(baseUrl, sessionId)
        }
      })
      .catch(() => {})

    // Cleanup on unmount or session change
    return () => {
      abortConnection()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, sessionId])

  // ==========================================
  // SSE connection management
  // ==========================================

  function startSSE(url: string, sid: string): AbortController {
    // Abort any existing connection
    abortConnection()

    const abort = new AbortController()
    abortRef.current = abort
    activeSessionRef.current = sid
    setIsStreaming(true)

    // Run SSE loop in background
    ;(async () => {
      try {
        await subscribeWithReconnect(url, sid, abort)
      } catch (err) {
        if ((err as Error).name !== 'AbortError' && activeSessionRef.current === sid) {
          setStreamEvents((prev) => [
            ...prev,
            { type: 'error', data: (err as Error).message || 'Stream error' },
          ])
        }
      } finally {
        if (activeSessionRef.current === sid) {
          setIsStreaming(false)

          // Stream completed — reload messages from DB (sidecar persists structured content)
          if (url) {
            fetch(`${url}/sessions/${sid}/messages`)
              .then((res) => res.json())
              .then((data) => {
                if (activeSessionRef.current === sid) {
                  setMessages(data.messages || [])
                  resetStreamState()
                }
              })
              .catch(() => {})
          }
        }
        if (abortRef.current === abort) {
          abortRef.current = null
        }
      }
    })()

    return abort
  }

  async function subscribeWithReconnect(
    url: string,
    sid: string,
    abort: AbortController,
  ): Promise<void> {
    let attempt = 0

    while (attempt < MAX_RECONNECT && !abort.signal.aborted) {
      if (activeSessionRef.current !== sid) return

      try {
        const afterParam = lastIndexRef.current >= 0 ? `?after=${lastIndexRef.current}` : ''
        const res = await fetch(`${url}/chat/events/${sid}${afterParam}`, {
          headers: { Accept: 'text/event-stream' },
          signal: abort.signal,
        })

        if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`)

        attempt = 0
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let done = false

        while (!done) {
          if (activeSessionRef.current !== sid) {
            reader.cancel().catch(() => {})
            return
          }

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

              if (event.index != null) lastIndexRef.current = event.index
              if (activeSessionRef.current !== sid) {
                reader.cancel().catch(() => {})
                return
              }

              done = handleEvent(event)
              if (done) return
            } catch {
              // malformed
            }
          }
        }

        if (!done && !abort.signal.aborted) {
          throw new Error('SSE connection closed unexpectedly')
        }
        return
      } catch (err) {
        if (abort.signal.aborted || (err as Error).name === 'AbortError') return
        if (activeSessionRef.current !== sid) return

        attempt++
        if (attempt >= MAX_RECONNECT) {
          setStreamEvents((prev) => [
            ...prev,
            { type: 'error', data: 'Lost connection after multiple retries' },
          ])
          return
        }

        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)))
      }
    }
  }

  // ==========================================
  // Event dispatcher
  // ==========================================

  function handleEvent(event: { type: string; data: unknown; index: number }): boolean {
    switch (event.type) {
      case 'thinking':
        thinkingRef.current += event.data
        setThinkingText(thinkingRef.current)
        setIsThinking(true)
        break

      case 'text':
        if (thinkingRef.current) setIsThinking(false)
        textRef.current += event.data
        setStreamingText(textRef.current)
        // Append to current trailing text segment
        segTextRef.current += event.data as string
        {
          const segs = segmentsRef.current
          const last = segs[segs.length - 1]
          if (last && last.kind === 'text') {
            last.content = segTextRef.current
          } else {
            segs.push({ kind: 'text', content: segTextRef.current })
          }
          setStreamSegments([...segs])
        }
        break

      case 'tool_use':
        try {
          const d = JSON.parse(event.data as string)
          setToolUses((prev) => (prev.some((t) => t.id === d.id) ? prev : [...prev, d]))
          setStreamingToolOutput('')
          // Cut text segment, start or extend tool_group segment
          segTextRef.current = ''
          {
            const segs = segmentsRef.current
            const last = segs[segs.length - 1]
            const tool = { id: d.id, name: d.name, input: d.input }
            if (last && last.kind === 'tool_group') {
              last.tools.push(tool)
            } else {
              segs.push({ kind: 'tool_group', tools: [tool] })
            }
            setStreamSegments([...segs])
          }
        } catch {
          /* skip */
        }
        break

      case 'tool_result':
        try {
          const d = JSON.parse(event.data as string)
          setToolResults((prev) => {
            const idx = prev.findIndex((r) => r.tool_use_id === d.tool_use_id)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = { tool_use_id: d.tool_use_id, content: d.content, is_error: d.is_error }
              return next
            }
            return [
              ...prev,
              { tool_use_id: d.tool_use_id, content: d.content, is_error: d.is_error },
            ]
          })
          setStreamingToolOutput('')
          // Update matching tool in segments with result
          {
            const segs = segmentsRef.current
            for (const seg of segs) {
              if (seg.kind !== 'tool_group') continue
              const tool = seg.tools.find((t) => t.id === d.tool_use_id)
              if (tool) {
                tool.result = d.content
                tool.isError = d.is_error
                break
              }
            }
            setStreamSegments([...segs])
          }
        } catch {
          /* skip */
        }
        break

      case 'tool_output':
        try {
          const parsed = JSON.parse(event.data as string)
          if (parsed._progress) {
            const elapsed = Math.round(parsed.elapsed_time_seconds ?? 0)
            setStatusText(`Running ${parsed.tool_name || 'tool'}... (${elapsed}s)`)
            break
          }
        } catch {
          /* raw stderr */
        }
        setStreamingToolOutput((prev) => {
          const next = prev + (prev ? '\n' : '') + (event.data as string)
          return next.length > 5000 ? next.slice(-5000) : next
        })
        break

      case 'status':
        try {
          const d = JSON.parse(event.data as string)
          if (d.session_id) {
            setStatusText(`Connected (${d.requested_model || d.model || 'claude'})`)
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

      case 'result':
        setStreamEvents((prev) => [...prev, { type: 'result', data: event.data }])
        setStatusText('')
        break

      case 'error':
        textRef.current += '\n\n**Error:** ' + (event.data as string)
        setStreamingText(textRef.current)
        setStreamEvents((prev) => [...prev, { type: 'error', data: event.data }])
        break

      case 'permission_request':
        setStreamEvents((prev) => [...prev, { type: 'permission_request', data: event.data }])
        break

      case 'tool_timeout':
        try {
          const parsed = JSON.parse(event.data as string)
          setStatusText(
            `${parsed.tool_name || 'Tool'} timed out (${Math.round(parsed.elapsed_time_seconds ?? 0)}s)`,
          )
        } catch {
          setStatusText('Tool execution timed out')
        }
        break

      case 'mode_change':
        try {
          const parsed = JSON.parse(event.data as string)
          setStatusText(`Mode: ${parsed.mode || event.data}`)
        } catch {
          setStatusText(`Mode: ${event.data}`)
        }
        setTimeout(() => setStatusText(''), 3000)
        break

      case 'task_update':
        window.dispatchEvent(new CustomEvent('tasks-updated'))
        break

      case 'keep_alive':
        break

      case 'rewind_point':
        setStreamEvents((prev) => [...prev, { type: 'rewind_point', data: event.data }])
        break

      case 'done':
        return true

      default:
        setStreamEvents((prev) => [
          ...prev,
          { type: event.type as StreamMessage['type'], data: event.data },
        ])
        break
    }
    return false
  }

  // ==========================================
  // Public API: send (existing session)
  // ==========================================

  const send = useCallback(
    (
      content: string,
      options?: {
        model?: string
        mode?: string
        providerId?: string
        systemPromptAppend?: string
        files?: FileAttachment[]
      },
    ) => {
      if (!baseUrl || !sessionId) return

      // Build display content with file metadata prefix (for message history)
      const filesMeta = options?.files?.length
        ? `<!--files:${JSON.stringify(options.files.map(({ id, name, type, size }) => ({ id, name, type, size })))}-->`
        : ''
      const displayContent = filesMeta + content

      // Optimistic user message
      setMessages((prev) => [
        ...prev,
        {
          id: `temp-${Date.now()}`,
          session_id: sessionId,
          role: 'user' as const,
          content: displayContent,
          created_at: new Date().toISOString(),
        },
      ])

      // Reset streaming state for new turn
      resetStreamState()

      // POST + SSE
      const abort = startSSE(baseUrl, sessionId)

      fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          content,
          model: options?.model,
          mode: options?.mode,
          provider_id: options?.providerId,
          systemPromptAppend: options?.systemPromptAppend,
          files: options?.files,
        }),
        signal: abort.signal,
      })
        .then((res) => {
          if (!res.ok) {
            res
              .json()
              .catch(() => ({ error: 'Request failed' }))
              .then((err) => {
                if (activeSessionRef.current === sessionId) {
                  setStreamEvents((prev) => [
                    ...prev,
                    { type: 'error', data: (err as { error?: string }).error || 'Request failed' },
                  ])
                }
              })
          }
        })
        .catch((err) => {
          if ((err as Error).name !== 'AbortError' && activeSessionRef.current === sessionId) {
            setStreamEvents((prev) => [...prev, { type: 'error', data: (err as Error).message }])
          }
        })
    },
    [baseUrl, sessionId, resetStreamState],
  )

  // ==========================================
  // Public API: sendNew (first message of a new session)
  // ==========================================

  const sendNew = useCallback(
    (
      targetSessionId: string,
      content: string,
      options?: {
        model?: string
        mode?: string
        providerId?: string
        systemPromptAppend?: string
        files?: FileAttachment[]
      },
    ) => {
      if (!baseUrl) return

      // Mark: the upcoming sessionId change (from setActiveSession) should NOT
      // trigger fetch-messages because we're about to stream into this session.
      skipNextLoadRef.current = true
      // Eagerly set activeSessionRef so guards in subscribeWithReconnect accept this session
      activeSessionRef.current = targetSessionId

      // Build display content with file metadata prefix
      const filesMeta = options?.files?.length
        ? `<!--files:${JSON.stringify(options.files.map(({ id, name, type, size }) => ({ id, name, type, size })))}-->`
        : ''
      const displayContent = filesMeta + content

      // Optimistic user message (fresh session, no history)
      setMessages([
        {
          id: `temp-${Date.now()}`,
          session_id: targetSessionId,
          role: 'user' as const,
          content: displayContent,
          created_at: new Date().toISOString(),
        },
      ])

      // Reset + start SSE
      resetStreamState()
      const abort = startSSE(baseUrl, targetSessionId)

      fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: targetSessionId,
          content,
          model: options?.model,
          mode: options?.mode,
          provider_id: options?.providerId,
          systemPromptAppend: options?.systemPromptAppend,
          files: options?.files,
        }),
        signal: abort.signal,
      })
        .then((res) => {
          if (!res.ok) {
            res
              .json()
              .catch(() => ({ error: 'Request failed' }))
              .then((err) => {
                if (activeSessionRef.current === targetSessionId) {
                  setStreamEvents((prev) => [
                    ...prev,
                    { type: 'error', data: (err as { error?: string }).error || 'Request failed' },
                  ])
                }
              })
          }
        })
        .catch((err) => {
          if (
            (err as Error).name !== 'AbortError' &&
            activeSessionRef.current === targetSessionId
          ) {
            setStreamEvents((prev) => [...prev, { type: 'error', data: (err as Error).message }])
          }
        })
    },
    [baseUrl, resetStreamState],
  )

  // ==========================================
  // Public API: interrupt
  // ==========================================

  const interrupt = useCallback(() => {
    if (!baseUrl || !sessionId) return
    abortConnection()
    setIsStreaming(false)
    fetch(`${baseUrl}/chat/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {})
  }, [baseUrl, sessionId, abortConnection])

  return {
    messages,
    streamEvents,
    streamingText,
    thinkingText,
    isThinking,
    isStreaming,
    toolUses,
    toolResults,
    statusText,
    streamingToolOutput,
    streamSegments,
    send,
    sendNew,
    interrupt,
  }
}
