/**
 * ChatView — Main chat interface with model selection, working directory,
 * tool calls, permissions, and file drop.
 *
 * Model selector lives inside MessageInput (aligned with CodePilot).
 * Model + provider_id are passed when creating sessions and sending messages.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import { FileDropZone } from './FileDropZone'
import { useSSEStream } from '../../hooks/useSSEStream'
import { useAppStore } from '../../stores'
import { useSidecar } from '../../hooks/useSidecar'
import { useDirectoryPicker } from '../../hooks/useDirectoryPicker'
import { Toaster, toast } from '../ui/toast'

const MODEL_STORAGE_KEY = 'miniclaw:last-model'
const PROVIDER_STORAGE_KEY = 'miniclaw:last-provider-id'

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
  const { getEffectiveDir, pickDirectory } = useDirectoryPicker()
  const {
    streamingText,
    isStreaming,
    messages: streamEvents,
    send,
    interrupt,
    clear,
  } = useSSEStream()

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  // Model + Provider state — persisted in localStorage
  const [currentModel, setCurrentModel] = useState(
    () => activeSession?.model || localStorage.getItem(MODEL_STORAGE_KEY) || 'sonnet',
  )
  const [currentProviderId, setCurrentProviderId] = useState(
    () => activeSession?.provider_id || localStorage.getItem(PROVIDER_STORAGE_KEY) || '',
  )

  // Sync model/provider from active session when switching sessions
  useEffect(() => {
    if (activeSession?.model) setCurrentModel(activeSession.model)
    if (activeSession?.provider_id) setCurrentProviderId(activeSession.provider_id)
  }, [activeSession?.model, activeSession?.provider_id])

  const handleModelChange = useCallback(
    (modelId: string) => {
      setCurrentModel(modelId)
      localStorage.setItem(MODEL_STORAGE_KEY, modelId)

      // Update the active session's model on the backend
      if (baseUrl && activeSessionId) {
        fetch(`${baseUrl}/sessions/${activeSessionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId }),
        }).catch(() => {})
      }
    },
    [baseUrl, activeSessionId],
  )

  // Skip clear on session switch when we just created + started streaming
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
        model: currentModel,
        mode: activeSession?.mode,
        providerId: currentProviderId,
      })
    },
    [baseUrl, activeSessionId, activeSession, send, addMessage, currentModel, currentProviderId],
  )

  // Auto-create session then send — used when no session is active
  const handleSendNew = useCallback(
    async (content: string) => {
      if (!baseUrl) return

      // Resolve working directory: cached → picker → abort
      let dir = getEffectiveDir()
      if (!dir) {
        dir = await pickDirectory()
        if (!dir) {
          toast('请先选择工作目录')
          return
        }
      }

      try {
        const res = await fetch(`${baseUrl}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: content.slice(0, 50),
            working_directory: dir,
            model: currentModel,
            provider_id: currentProviderId,
          }),
        })
        const data = await res.json()
        if (!data.session) return
        const session = data.session
        addSession(session)
        skipNextClearRef.current = true
        setActiveSession(session.id)
        addMessage({
          id: `temp-${Date.now()}`,
          session_id: session.id,
          role: 'user',
          content,
          created_at: new Date().toISOString(),
        })
        send(baseUrl, session.id, content, {
          model: currentModel,
          mode: session.mode,
          providerId: currentProviderId,
        })
      } catch (err) {
        toast(err instanceof Error ? err.message : '创建会话失败')
      }
    },
    [
      baseUrl,
      addSession,
      setActiveSession,
      addMessage,
      send,
      getEffectiveDir,
      pickDirectory,
      currentModel,
      currentProviderId,
    ],
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

  // Format directory display (show last 2 segments)
  const formatDir = (dir: string): string => {
    const parts = dir.split('/')
    if (parts.length <= 2) return dir
    return '.../' + parts.slice(-2).join('/')
  }

  // Welcome / empty state — no active session
  if (!activeSessionId) {
    const cachedDir = getEffectiveDir()
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Welcome area */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="text-6xl">🦞</div>
            <h2 className="text-2xl font-semibold text-zinc-700 dark:text-zinc-300">小龙虾</h2>
            <p className="text-zinc-500 dark:text-zinc-400">输入消息开始新对话</p>
            {/* Working directory indicator */}
            <button
              onClick={async () => {
                await pickDirectory()
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 transition-colors"
              title={cachedDir || '点击选择工作目录'}
            >
              📁 {cachedDir ? formatDir(cachedDir) : '选择工作目录'}
            </button>
          </div>
        </div>
        {/* Input with model selector */}
        <MessageInput
          onSend={handleSendNew}
          isStreaming={false}
          disabled={!ready}
          currentModel={currentModel}
          onModelChange={handleModelChange}
        />
        <Toaster position="bottom-right" />
      </div>
    )
  }

  return (
    <FileDropZone onFilesDropped={handleFilesDropped} disabled={!ready}>
      {/* Session header — title + working dir only (model selector is in input) */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 min-w-0">
        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
          {activeSession?.title || 'New Chat'}
        </div>
        {activeSession?.working_directory && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 truncate max-w-[200px]"
            title={activeSession.working_directory}
          >
            📁 {formatDir(activeSession.working_directory)}
          </span>
        )}
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
        currentModel={currentModel}
        onModelChange={handleModelChange}
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
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
