/**
 * ChatView — Main chat interface with Markdown rendering, tool calls,
 * permissions, model selector, context usage, and file drop.
 */

import { useEffect, useCallback, useRef } from 'react'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { ModelSelector } from './ModelSelector'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import { FileDropZone } from './FileDropZone'
import { useSSEStream } from '../../hooks/useSSEStream'
import { useAppStore } from '../../stores'
import { useSidecar } from '../../hooks/useSidecar'
import { Toaster, toast } from '../ui/toast'

export function ChatView() {
  const { baseUrl, ready } = useSidecar()
  const {
    activeSessionId,
    messages,
    setMessages,
    addMessage,
    addSession,
    setActiveSession,
    sessions,
  } = useAppStore()
  const {
    streamingText,
    isStreaming,
    messages: streamEvents,
    send,
    interrupt,
    clear,
  } = useSSEStream()

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  // When handleSendNew creates a session and immediately starts streaming,
  // the activeSessionId change triggers this effect. Skip clear() in that
  // case so we don't wipe the in-flight SSE stream data.
  const skipNextClearRef = useRef(false)

  // Load messages when session changes
  useEffect(() => {
    if (!baseUrl || !activeSessionId) return
    if (skipNextClearRef.current) {
      skipNextClearRef.current = false
    } else {
      clear()
    }
    fetch(`${baseUrl}/sessions/${activeSessionId}/messages`)
      .then((res) => res.json())
      .then((data) => setMessages(data.messages || []))
      .catch(() => setMessages([]))
  }, [baseUrl, activeSessionId, setMessages, clear])

  const handleSend = useCallback(
    (content: string) => {
      if (!baseUrl || !activeSessionId) return
      addMessage({
        id: `temp-${Date.now()}`,
        session_id: activeSessionId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      })
      send(baseUrl, activeSessionId, content, {
        model: activeSession?.model,
        mode: activeSession?.mode,
      })
    },
    [baseUrl, activeSessionId, activeSession, send, addMessage],
  )

  // Auto-create session then send — used when no session is active
  const handleSendNew = useCallback(
    async (content: string) => {
      if (!baseUrl) return
      try {
        const res = await fetch(`${baseUrl}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: content.slice(0, 50), working_directory: '~' }),
        })
        const data = await res.json()
        if (!data.session) return
        const session = data.session
        addSession(session)
        // Mark so the useEffect triggered by setActiveSession won't clear()
        // the SSE stream that send() is about to start.
        skipNextClearRef.current = true
        setActiveSession(session.id)
        addMessage({
          id: `temp-${Date.now()}`,
          session_id: session.id,
          role: 'user',
          content,
          created_at: new Date().toISOString(),
        })
        send(baseUrl, session.id, content, { model: session.model, mode: session.mode })
      } catch (err) {
        toast(err instanceof Error ? err.message : '创建会话失败')
      }
    },
    [baseUrl, addSession, setActiveSession, addMessage, send],
  )

  const handleInterrupt = useCallback(() => {
    if (!baseUrl || !activeSessionId) return
    interrupt(baseUrl, activeSessionId)
  }, [baseUrl, activeSessionId, interrupt])

  const handlePermissionAllow = useCallback(
    (permissionId: string) => {
      if (!baseUrl) return
      fetch(`${baseUrl}/chat/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_id: permissionId, allow: true }),
      }).catch(() => toast('权限响应发送失败'))
    },
    [baseUrl],
  )

  const handlePermissionDeny = useCallback(
    (permissionId: string) => {
      if (!baseUrl) return
      fetch(`${baseUrl}/chat/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_id: permissionId, allow: false }),
      }).catch(() => toast('权限响应发送失败'))
    },
    [baseUrl],
  )

  const handleFilesDropped = useCallback(
    async (files: File[]) => {
      if (!baseUrl || !activeSessionId) return
      // Upload files and mention in message
      const names: string[] = []
      for (const file of files) {
        try {
          const data = await fileToBase64(file)
          const res = await fetch(`${baseUrl}/uploads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, data, type: file.type }),
          })
          const result = await res.json()
          names.push(result.name || file.name)
        } catch {
          toast(`上传失败: ${file.name}`)
        }
      }
      if (names.length > 0) {
        toast(`已上传 ${names.length} 个文件`)
      }
    },
    [baseUrl, activeSessionId],
  )

  // When stream completes, add assistant message
  useEffect(() => {
    if (!isStreaming && streamingText) {
      addMessage({
        id: `assistant-${Date.now()}`,
        session_id: activeSessionId || '',
        role: 'assistant',
        content: streamingText,
        created_at: new Date().toISOString(),
      })
      clear()
    }
  }, [isStreaming, streamingText, addMessage, clear])

  if (!activeSessionId) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Welcome area */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="text-6xl">🦞</div>
            <h2 className="text-2xl font-semibold text-zinc-700 dark:text-zinc-300">小龙虾</h2>
            <p className="text-zinc-500 dark:text-zinc-400">输入消息开始新对话</p>
          </div>
        </div>
        {/* Input always visible */}
        <MessageInput onSend={handleSendNew} isStreaming={false} disabled={!ready} />
        <Toaster position="bottom-right" />
      </div>
    )
  }

  return (
    <FileDropZone onFilesDropped={handleFilesDropped} disabled={!ready}>
      {/* Session header with model selector */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
          {activeSession?.title || 'New Chat'}
        </div>
        <ModelSelector />
      </div>

      <MessageList
        messages={messages}
        streamingText={streamingText}
        streamEvents={streamEvents}
        isStreaming={isStreaming}
        onPermissionAllow={handlePermissionAllow}
        onPermissionDeny={handlePermissionDeny}
      />

      {/* Context usage indicator */}
      <ContextUsageIndicator streamEvents={streamEvents} />

      <MessageInput
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        isStreaming={isStreaming}
        disabled={!ready}
      />
      <Toaster position="bottom-right" />
    </FileDropZone>
  )
}

/** Convert a File to base64 string */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remove data:xxx;base64, prefix
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
