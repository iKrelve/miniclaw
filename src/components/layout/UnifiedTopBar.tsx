/**
 * UnifiedTopBar — Global top bar (CodePilot-aligned).
 *
 * Height: 48px. Draggable title bar region.
 * Chat view: session title (editable) + project name + Git/FileTree buttons
 * Other views: view name label
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { FolderGit2, FolderOpen, Pencil } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@radix-ui/react-tooltip'
import { useAppStore } from '../../stores'
import { useSidecar } from '../../hooks/useSidecar'

interface UnifiedTopBarProps {
  currentView: string
}

const viewLabels: Record<string, string> = {
  chat: '对话',
  settings: '设置',
  terminal: '终端',
  git: 'Git',
  files: '文件',
  plugins: '插件',
  skills: '技能',
}

export function UnifiedTopBar({ currentView }: UnifiedTopBarProps) {
  const { activeSessionId, sessions } = useAppStore()
  const { baseUrl } = useSidecar()
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const isChatView = currentView === 'chat' && !!activeSessionId

  // Extract project name from working directory
  const projectName = activeSession?.working_directory
    ? activeSession.working_directory.split('/').filter(Boolean).pop() || ''
    : ''

  // --- Title editing (matching CodePilot) ---
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback(() => {
    setEditValue(activeSession?.title || 'New Chat')
    setEditing(true)
  }, [activeSession?.title])

  const saveTitle = useCallback(async () => {
    const trimmed = editValue.trim()
    setEditing(false)
    if (!trimmed || !baseUrl || !activeSessionId) return
    if (trimmed === activeSession?.title) return
    try {
      await fetch(`${baseUrl}/sessions/${activeSessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      // Update local store
      useAppStore
        .getState()
        .setSessions(sessions.map((s) => (s.id === activeSessionId ? { ...s, title: trimmed } : s)))
    } catch {
      // silent
    }
  }, [editValue, baseUrl, activeSessionId, activeSession?.title, sessions])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') saveTitle()
      else if (e.key === 'Escape') setEditing(false)
    },
    [saveTitle],
  )

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="flex h-12 shrink-0 items-center gap-2 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-lg px-3 border-b border-zinc-200/50 dark:border-zinc-800/50"
        data-tauri-drag-region
      >
        {/* Left content */}
        <div className="flex items-center gap-1.5 min-w-0 shrink">
          {isChatView ? (
            // Chat view: editable title + project name
            <>
              {editing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={saveTitle}
                  className="h-7 text-sm font-medium max-w-[200px] px-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              ) : (
                <div className="flex items-center gap-1 max-w-[200px]">
                  <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
                    {activeSession?.title || 'New Chat'}
                  </h2>
                  <button
                    onClick={startEdit}
                    className="shrink-0 p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              )}

              {projectName && activeSession?.title && (
                <span className="text-xs text-zinc-400 shrink-0">/</span>
              )}

              {projectName && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-zinc-400 shrink-0 truncate max-w-[120px] cursor-default">
                      {projectName}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-xs text-white dark:text-zinc-900 break-all max-w-[300px]">
                    {activeSession?.working_directory}
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          ) : (
            // Non-chat view: show view name
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {viewLabels[currentView] || currentView}
            </h2>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: panel toggle buttons (chat detail only) */}
        {isChatView && (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="flex items-center gap-1 h-7 px-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                  <FolderGit2 size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-xs text-white dark:text-zinc-900"
              >
                Git (即将支持)
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button className="flex items-center gap-1 h-7 px-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                  <FolderOpen size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-xs text-white dark:text-zinc-900"
              >
                文件树 (即将支持)
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
