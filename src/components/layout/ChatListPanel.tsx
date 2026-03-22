/**
 * ChatListPanel — Collapsible session list panel (CodePilot-aligned).
 *
 * Width: 240px. Slides in/out via NavRail Chat button.
 * Features: new chat button, search, session list with context menu.
 */

import { useEffect, useCallback, useState, useRef } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../stores'
import { useSidecar } from '../../hooks/useSidecar'
import { useDirectoryPicker } from '../../hooks/useDirectoryPicker'

interface ChatListPanelProps {
  open: boolean
  onSelectSession: (id: string) => void
}

export function ChatListPanel({ open, onSelectSession }: ChatListPanelProps) {
  const { baseUrl } = useSidecar()
  const { sessions, activeSessionId, setSessions, setActiveSession, addSession, removeSession } =
    useAppStore()
  const { getEffectiveDir, pickDirectory } = useDirectoryPicker()
  const [search, setSearch] = useState('')
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  // Load sessions on mount
  useEffect(() => {
    if (!baseUrl) return
    fetch(`${baseUrl}/sessions`)
      .then((res) => res.json())
      .then((data) => setSessions(data.sessions || []))
      .catch(() => {})
  }, [baseUrl, setSessions])

  // Periodic refresh (catch server-side created sessions)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!baseUrl) return
    intervalRef.current = setInterval(() => {
      fetch(`${baseUrl}/sessions`)
        .then((res) => res.json())
        .then((data) => setSessions(data.sessions || []))
        .catch(() => {})
    }, 5000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [baseUrl, setSessions])

  const createSessionWithDir = useCallback(
    async (dir: string) => {
      if (!baseUrl) return
      const res = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ working_directory: dir }),
      })
      const data = await res.json()
      if (data.session) {
        addSession(data.session)
        setActiveSession(data.session.id)
        onSelectSession(data.session.id)
      }
    },
    [baseUrl, addSession, setActiveSession, onSelectSession],
  )

  const handleNewChat = useCallback(async () => {
    if (!baseUrl) return
    const cached = getEffectiveDir()
    if (cached) {
      try {
        await createSessionWithDir(cached)
        return
      } catch {
        // fall through
      }
    }
    const picked = await pickDirectory()
    if (picked) {
      try {
        await createSessionWithDir(picked)
      } catch {
        // error
      }
    }
  }, [baseUrl, getEffectiveDir, pickDirectory, createSessionWithDir])

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (!baseUrl) return
      try {
        await fetch(`${baseUrl}/sessions/${id}`, { method: 'DELETE' })
        removeSession(id)
        setContextMenu(null)
      } catch {
        // error
      }
    },
    [baseUrl, removeSession],
  )

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }, [])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

  const filtered = sessions.filter(
    (s) => !search || s.title.toLowerCase().includes(search.toLowerCase()),
  )

  // Group sessions by working_directory (project)
  const groups = groupByProject(filtered)

  if (!open) return null

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col overflow-hidden bg-[var(--sidebar)]/80 backdrop-blur-xl border-r border-[var(--sidebar-border)]">
      {/* Header — extra top padding for macOS traffic lights */}
      <div className="flex h-12 shrink-0 items-center px-3 mt-5">
        <span className="text-sm font-semibold text-[var(--sidebar-foreground)]">小龙虾</span>
      </div>

      {/* New Chat button */}
      <div className="px-3 pb-2">
        <button
          onClick={handleNewChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 px-3 h-8 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
        >
          <Plus size={14} />
          新对话
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索会话..."
            className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 placeholder:text-zinc-400 h-8 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </div>

      {/* Session list grouped by project */}
      <div className="flex-1 overflow-y-auto px-3">
        {/* Section title */}
        <div className="px-1 pt-1 pb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
            会话
          </span>
        </div>

        {groups.length === 0 ? (
          <p className="px-1 py-3 text-[11px] text-[var(--muted-foreground)]/60">
            {search ? '未找到匹配' : '暂无会话'}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.dir || '__none'} className="mt-1 first:mt-0">
              {/* Project folder header */}
              {group.dir && (
                <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] font-medium text-[var(--muted-foreground)] truncate">
                  <span className="truncate" title={group.dir}>
                    📁 {group.dir.split('/').filter(Boolean).pop() || group.dir}
                  </span>
                </div>
              )}

              {/* Session items */}
              <div className="flex flex-col gap-0.5">
                {group.sessions.map((session) => {
                  const isActive = activeSessionId === session.id
                  return (
                    <button
                      key={session.id}
                      onClick={() => {
                        setActiveSession(session.id)
                        onSelectSession(session.id)
                      }}
                      onContextMenu={(e) => handleContextMenu(e, session.id)}
                      className={cn(
                        'w-full text-left px-2 py-1.5 rounded-lg text-xs truncate transition-colors',
                        isActive
                          ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] font-medium'
                          : 'text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)]',
                      )}
                    >
                      {session.title || 'New Chat'}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Version footer */}
      <div className="shrink-0 px-3 py-2 text-center">
        <span className="text-[10px] text-[var(--muted-foreground)]/40">v0.1.0</span>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => handleDeleteSession(contextMenu.id)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Trash2 size={14} />
            删除会话
          </button>
        </div>
      )}
    </aside>
  )
}

/** Group sessions by working_directory for project-based grouping */
interface ProjectGroup {
  dir: string
  sessions: Array<{ id: string; title: string; working_directory?: string }>
}

function groupByProject(
  sessions: Array<{ id: string; title: string; working_directory?: string }>,
): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>()
  for (const s of sessions) {
    const dir = s.working_directory || ''
    let group = map.get(dir)
    if (!group) {
      group = { dir, sessions: [] }
      map.set(dir, group)
    }
    group.sessions.push(s)
  }
  return Array.from(map.values())
}
