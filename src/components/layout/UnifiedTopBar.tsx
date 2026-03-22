/**
 * UnifiedTopBar — Global top bar (CodePilot-aligned).
 *
 * Height: 48px. Draggable title bar region.
 * Left: session title + project name
 * Right: Git branch button + file tree button (placeholders for future)
 */

import { FolderGit2, FolderOpen } from 'lucide-react'
import { useAppStore } from '../../stores'

interface UnifiedTopBarProps {
  currentView: string
}

export function UnifiedTopBar({ currentView }: UnifiedTopBarProps) {
  const { activeSessionId, sessions } = useAppStore()
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const isChatView = currentView === 'chat' && !!activeSessionId

  // Extract project name from working directory
  const projectName = activeSession?.working_directory
    ? activeSession.working_directory.split('/').filter(Boolean).pop() || ''
    : ''

  return (
    <div
      className="flex h-12 shrink-0 items-center gap-2 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-lg px-3 border-b border-zinc-200/50 dark:border-zinc-800/50"
      data-tauri-drag-region
    >
      {/* Left: session title + project folder */}
      <div className="flex items-center gap-1.5 min-w-0 shrink">
        {isChatView && activeSession?.title && (
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">
            {activeSession.title}
          </h2>
        )}

        {isChatView && projectName && activeSession?.title && (
          <span className="text-xs text-zinc-400 shrink-0">/</span>
        )}

        {isChatView && projectName && (
          <span
            className="text-xs text-zinc-400 shrink-0 truncate max-w-[120px]"
            title={activeSession?.working_directory}
          >
            {projectName}
          </span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: panel toggle buttons (chat detail route only) */}
      {isChatView && (
        <div className="flex items-center gap-1">
          {/* Git branch — placeholder */}
          <button
            className="flex items-center gap-1 h-7 px-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Git (即将支持)"
          >
            <FolderGit2 size={16} />
          </button>

          {/* File tree — placeholder */}
          <button
            className="flex items-center gap-1 h-7 px-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="文件树 (即将支持)"
          >
            <FolderOpen size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
