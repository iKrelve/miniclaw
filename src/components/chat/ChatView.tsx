/**
 * ChatView — Main chat interface.
 *
 * All session-switch lifecycle (abort SSE, clear state, fetch messages,
 * re-subscribe to running sessions) is handled by useSSEStream internally.
 * ChatView is a pure declarative consumer.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { ChatPermissionSelector } from './ChatPermissionSelector'
import { BrowserModeSelector, type BrowserMode } from './BrowserModeSelector'
import { ContextUsageIndicator } from './ContextUsageIndicator'
// FileDropZone removed — MessageInput handles drag-and-drop natively
import { useSSEStream } from '../../hooks/useSSEStream'
import logo from '../../assets/logo.png'
import { useAppStore } from '../../stores'
import { useSidecar } from '../../hooks/useSidecar'
import { useDirectoryPicker } from '../../hooks/useDirectoryPicker'
import { Toaster, toast } from '../ui/toast'
import type { FileAttachment } from '../../../shared/types'

const MODEL_STORAGE_KEY = 'miniclaw:last-model'
const PROVIDER_STORAGE_KEY = 'miniclaw:last-provider-id'

export function ChatView() {
  const { baseUrl, ready } = useSidecar()
  const { activeSessionId, addSession, setActiveSession, updateSession, sessions } = useAppStore()
  const { getEffectiveDir, pickDirectory } = useDirectoryPicker()

  // SSE stream hook — automatically manages lifecycle on sessionId change
  const stream = useSSEStream(baseUrl, activeSessionId)

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  // Model + Provider state — persisted in localStorage
  const [currentModel, setCurrentModel] = useState(
    () => activeSession?.model || localStorage.getItem(MODEL_STORAGE_KEY) || 'sonnet',
  )
  const [currentProviderId, setCurrentProviderId] = useState(
    () => activeSession?.provider_id || localStorage.getItem(PROVIDER_STORAGE_KEY) || '',
  )

  // Permission profile — session-level
  const [permissionProfile, setPermissionProfile] = useState<'default' | 'full_access'>(
    () => activeSession?.permission_profile || 'default',
  )

  // Browser mode — poll status from sidecar
  const [browserMode, setBrowserMode] = useState<BrowserMode>('off')

  const refreshBrowserStatus = useCallback(() => {
    if (!baseUrl) return
    fetch(`${baseUrl}/browser/status`)
      .then((res) => res.json())
      .then((data) =>
        setBrowserMode(data.running ? (data.headless ? 'headless' : 'headed') : 'off'),
      )
      .catch(() => setBrowserMode('off'))
  }, [baseUrl])

  // Initial fetch on mount
  useEffect(() => {
    refreshBrowserStatus()
  }, [refreshBrowserStatus])

  // Auto-refresh when tool results arrive that involve browser-action.
  // This catches the case where the AI auto-starts Chrome via CLI.
  useEffect(() => {
    if (browserMode !== 'off') return
    const hasBrowserResult = stream.toolResults.some(
      (r) => r.content?.includes('browser') || r.content?.includes('Screenshot'),
    )
    if (hasBrowserResult) refreshBrowserStatus()
  }, [stream.toolResults, browserMode, refreshBrowserStatus])

  const handleBrowserModeChange = useCallback((mode: BrowserMode) => setBrowserMode(mode), [])

  // Sync model/provider/permission from active session when switching
  useEffect(() => {
    if (activeSession?.model) setCurrentModel(activeSession.model)
    if (activeSession?.provider_id) setCurrentProviderId(activeSession.provider_id)
    setPermissionProfile(activeSession?.permission_profile || 'default')
  }, [activeSession?.model, activeSession?.provider_id, activeSession?.permission_profile])

  const handlePermissionChange = useCallback(
    (profile: 'default' | 'full_access') => {
      setPermissionProfile(profile)
      if (activeSessionId) updateSession(activeSessionId, { permission_profile: profile })
    },
    [activeSessionId, updateSession],
  )

  const handleModelChange = useCallback(
    (providerId: string, modelId: string) => {
      setCurrentModel(modelId)
      setCurrentProviderId(providerId)
      localStorage.setItem(MODEL_STORAGE_KEY, modelId)
      localStorage.setItem(PROVIDER_STORAGE_KEY, providerId)
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

  // ==========================================
  // Send message (existing session)
  // ==========================================

  const handleSend = useCallback(
    (content: string, opts?: { systemPromptAppend?: string; files?: FileAttachment[] }) => {
      stream.send(content, {
        model: currentModel,
        mode: activeSession?.mode,
        providerId: currentProviderId,
        systemPromptAppend: opts?.systemPromptAppend,
        files: opts?.files,
      })
    },
    [stream, currentModel, currentProviderId, activeSession?.mode],
  )

  // ==========================================
  // Send message (new session — auto-create)
  // ==========================================

  const handleSendNew = useCallback(
    async (content: string, opts?: { systemPromptAppend?: string; files?: FileAttachment[] }) => {
      if (!baseUrl) return

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
        // sendNew must be called BEFORE setActiveSession — it eagerly sets
        // skipNextLoadRef + activeSessionRef so the hook's useEffect (triggered
        // by setActiveSession) won't race with the SSE connection.
        stream.sendNew(session.id, content, {
          model: currentModel,
          mode: session.mode,
          providerId: currentProviderId,
          systemPromptAppend: opts?.systemPromptAppend,
          files: opts?.files,
        })
        setActiveSession(session.id)
      } catch (err) {
        toast(err instanceof Error ? err.message : '创建会话失败')
      }
    },
    [
      baseUrl,
      addSession,
      setActiveSession,
      stream,
      getEffectiveDir,
      pickDirectory,
      currentModel,
      currentProviderId,
    ],
  )

  // ==========================================
  // Permissions
  // ==========================================

  const handlePermissionAllow = useCallback(
    (permissionId: string, updatedInput?: Record<string, unknown>) => {
      if (!baseUrl) return
      fetch(`${baseUrl}/chat/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permission_id: permissionId,
          allow: true,
          ...(updatedInput ? { updated_input: updatedInput } : {}),
        }),
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

  // Auto-approve permissions in full_access mode
  const autoApprovedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (permissionProfile !== 'full_access' || !baseUrl) return
    for (const e of stream.streamEvents) {
      if (e.type !== 'permission_request') continue
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data as string) : e.data
        const id = (data as { id: string }).id
        if (id && !autoApprovedRef.current.has(id)) {
          autoApprovedRef.current.add(id)
          handlePermissionAllow(id)
        }
      } catch {
        // skip
      }
    }
  }, [permissionProfile, stream.streamEvents, baseUrl, handlePermissionAllow])

  // ==========================================
  // Toolbar widgets (shared between empty state and chat)
  // ==========================================

  const toolbar = (
    <>
      <ChatPermissionSelector
        sessionId={activeSessionId ?? undefined}
        permissionProfile={permissionProfile}
        onPermissionChange={handlePermissionChange}
      />
      <BrowserModeSelector mode={browserMode} onModeChange={handleBrowserModeChange} />
    </>
  )

  // ==========================================
  // Render: empty state (no active session)
  // ==========================================

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
          extraToolbar={toolbar}
        />
        <Toaster position="bottom-right" />
      </div>
    )
  }

  // ==========================================
  // Render: active session
  // ==========================================

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <MessageList
        messages={stream.messages}
        streamingContent={stream.streamingText}
        thinkingContent={stream.thinkingText}
        isThinking={stream.isThinking}
        isStreaming={stream.isStreaming}
        toolUses={stream.toolUses}
        toolResults={stream.toolResults}
        streamingToolOutput={stream.streamingToolOutput}
        statusText={stream.statusText}
        streamEvents={stream.streamEvents}
        streamSegments={stream.streamSegments}
        onForceStop={stream.interrupt}
        onPermissionAllow={handlePermissionAllow}
        onPermissionDeny={handlePermissionDeny}
      />

      <ContextUsageIndicator streamEvents={stream.streamEvents} />

      <MessageInput
        onSend={handleSend}
        onInterrupt={stream.interrupt}
        isStreaming={stream.isStreaming}
        disabled={!ready}
        currentModel={currentModel}
        currentProviderId={currentProviderId}
        onModelChange={handleModelChange}
        extraToolbar={toolbar}
      />
      <Toaster position="bottom-right" />
    </div>
  )
}
