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
import { ChatPermissionSelector } from './ChatPermissionSelector'
import { BrowserModeSelector, type BrowserMode } from './BrowserModeSelector'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import { FileDropZone } from './FileDropZone'
import { useSSEStream } from '../../hooks/useSSEStream'
import logo from '../../assets/logo.png'
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
    updateSession,
    sessions,
  } = useAppStore()
  const { getEffectiveDir, pickDirectory } = useDirectoryPicker()
  const {
    streamingText,
    thinkingText,
    isThinking,
    isStreaming,
    messages: streamEvents,
    toolUses,
    toolResults,
    statusText,
    streamingToolOutput,
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

  // Permission profile — session-level (default or full_access)
  const [permissionProfile, setPermissionProfile] = useState<'default' | 'full_access'>(
    () => activeSession?.permission_profile || 'default',
  )

  // Browser mode — synced with sidecar's actual Chrome state on startup.
  // localStorage is only a hint; the sidecar is the source of truth.
  const [browserMode, setBrowserMode] = useState<BrowserMode>('off')

  // On mount (or when sidecar becomes ready), query actual Chrome status
  useEffect(() => {
    if (!baseUrl) return
    fetch(`${baseUrl}/browser/status`)
      .then((res) => res.json())
      .then((data) => {
        if (data.running) {
          setBrowserMode(data.headless ? 'headless' : 'headed')
        } else {
          setBrowserMode('off')
        }
      })
      .catch(() => setBrowserMode('off'))
  }, [baseUrl])

  const handleBrowserModeChange = useCallback((mode: BrowserMode) => {
    setBrowserMode(mode)
  }, [])

  // Sync model/provider/permission from active session when switching sessions
  useEffect(() => {
    if (activeSession?.model) setCurrentModel(activeSession.model)
    if (activeSession?.provider_id) setCurrentProviderId(activeSession.provider_id)
    setPermissionProfile(activeSession?.permission_profile || 'default')
  }, [activeSession?.model, activeSession?.provider_id, activeSession?.permission_profile])

  const handlePermissionChange = useCallback(
    (profile: 'default' | 'full_access') => {
      setPermissionProfile(profile)
      if (activeSessionId) {
        updateSession(activeSessionId, { permission_profile: profile })
      }
    },
    [activeSessionId, updateSession],
  )

  const handleModelChange = useCallback(
    (providerId: string, modelId: string) => {
      setCurrentModel(modelId)
      setCurrentProviderId(providerId)
      localStorage.setItem(MODEL_STORAGE_KEY, modelId)
      localStorage.setItem(PROVIDER_STORAGE_KEY, providerId)

      // Update the active session's model on the backend
      if (baseUrl && activeSessionId) {
        fetch(`${baseUrl}/sessions/${activeSessionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId, provider_id: providerId }),
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
    (content: string, opts?: { systemPromptAppend?: string }) => {
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
        systemPromptAppend: opts?.systemPromptAppend,
      })
    },
    [baseUrl, activeSessionId, activeSession, send, addMessage, currentModel, currentProviderId],
  )

  // Auto-create session then send — used when no session is active
  const handleSendNew = useCallback(
    async (content: string, opts?: { systemPromptAppend?: string }) => {
      if (!baseUrl) return

      // Resolve working directory: cached -> picker -> abort
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
          systemPromptAppend: opts?.systemPromptAppend,
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

  // Auto-approve permission requests when in full_access mode (frontend fallback)
  const autoApprovedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (permissionProfile !== 'full_access' || !baseUrl) return
    for (const e of streamEvents) {
      if (e.type !== 'permission_request') continue
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data as string) : e.data
        const id = (data as { id: string }).id
        if (id && !autoApprovedRef.current.has(id)) {
          autoApprovedRef.current.add(id)
          handlePermissionAllow(id)
        }
      } catch {
        // skip malformed
      }
    }
  }, [permissionProfile, streamEvents, baseUrl, handlePermissionAllow])

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

  // When stream completes, reload messages from sidecar (which persists
  // structured tool_use/tool_result blocks alongside text).
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && baseUrl && activeSessionId) {
      fetch(`${baseUrl}/sessions/${activeSessionId}/messages`)
        .then((res) => res.json())
        .then((data) => setMessages(data.messages || []))
        .catch(() => {})
      clear()
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming, baseUrl, activeSessionId, setMessages, clear])

  // Empty state — no active session (just show input at bottom)
  if (!activeSessionId) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <img src={logo} alt="小龙虾" className="w-14 h-14 mx-auto" />
            <p className="text-sm text-zinc-400 dark:text-zinc-500">输入消息开始新对话</p>
          </div>
        </div>
        <MessageInput
          onSend={handleSendNew}
          isStreaming={false}
          disabled={!ready}
          currentModel={currentModel}
          currentProviderId={currentProviderId}
          onModelChange={handleModelChange}
          extraToolbar={
            <>
              <ChatPermissionSelector
                permissionProfile={permissionProfile}
                onPermissionChange={handlePermissionChange}
              />
              <BrowserModeSelector mode={browserMode} onModeChange={handleBrowserModeChange} />
            </>
          }
        />
        <Toaster position="bottom-right" />
      </div>
    )
  }

  return (
    <FileDropZone onFilesDropped={handleFilesDropped} disabled={!ready}>
      <MessageList
        messages={messages}
        streamingContent={streamingText}
        thinkingContent={thinkingText}
        isThinking={isThinking}
        isStreaming={isStreaming}
        toolUses={toolUses}
        toolResults={toolResults}
        streamingToolOutput={streamingToolOutput}
        statusText={statusText}
        streamEvents={streamEvents}
        onForceStop={handleInterrupt}
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
        currentProviderId={currentProviderId}
        onModelChange={handleModelChange}
        extraToolbar={
          <>
            <ChatPermissionSelector
              sessionId={activeSessionId}
              permissionProfile={permissionProfile}
              onPermissionChange={handlePermissionChange}
            />
            <BrowserModeSelector mode={browserMode} onModeChange={handleBrowserModeChange} />
          </>
        }
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
