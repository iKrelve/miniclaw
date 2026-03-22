/**
 * ChatListPanel — Collapsible session list panel (CodePilot-aligned).
 *
 * Uses Radix Dialog for delete confirmations (window.confirm is broken in Tauri webview).
 */

import { useEffect, useCallback, useState, useRef } from 'react'
import {
  Plus,
  Search,
  Trash2,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  X,
  MoreHorizontal,
  Copy,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
  TooltipPortal,
} from '@radix-ui/react-tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog'
import { cn } from '../../lib/utils'
import { toast } from '../ui/toast'
import { useAppStore } from '../../stores'
import { useSidecar } from '../../hooks/useSidecar'
import { useDirectoryPicker } from '../../hooks/useDirectoryPicker'

interface ChatListPanelProps {
  open: boolean
  onSelectSession: (id: string) => void
}

/** Pending delete confirmation state */
type PendingDelete =
  | { type: 'session'; id: string; title: string }
  | { type: 'project'; dir: string; name: string; count: number }
  | null

export function ChatListPanel({ open, onSelectSession }: ChatListPanelProps) {
  const { baseUrl } = useSidecar()
  const { sessions, activeSessionId, setSessions, setActiveSession, removeSession } = useAppStore()
  const { pickDirectory } = useDirectoryPicker()
  const [search, setSearch] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null) // track which session's dropdown is open
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [pending, setPending] = useState<PendingDelete>(null)

  // Load sessions on mount; restore persisted activeSessionId if still valid
  useEffect(() => {
    if (!baseUrl) return
    fetch(`${baseUrl}/sessions`)
      .then((res) => res.json())
      .then((data) => {
        const list = data.sessions || []
        setSessions(list)
        // If a persisted session ID exists but hasn't been loaded yet, validate & restore
        if (activeSessionId && list.some((s: { id: string }) => s.id === activeSessionId)) {
          onSelectSession(activeSessionId)
        } else if (activeSessionId && !list.some((s: { id: string }) => s.id === activeSessionId)) {
          // Persisted session no longer exists — clear stale ID
          setActiveSession(null)
        }
      })
      .catch(() => {})
    // Run only once on mount — activeSessionId read from store initial value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl])

  // Periodic refresh — merge server data with locally-added sessions.
  // Without merging, a session just added via `addSession` (optimistic, at
  // index 0) can jump to a different position when the 5s poll replaces the
  // array with server-ordered data where it may not yet appear or may have
  // an older `updated_at` than other active sessions.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!baseUrl) return
    intervalRef.current = setInterval(() => {
      fetch(`${baseUrl}/sessions`)
        .then((res) => res.json())
        .then((data) => {
          const server: Array<{ id: string }> = data.sessions || []
          const serverIds = new Set(server.map((s) => s.id))

          // Preserve any locally-added sessions that the server hasn't
          // returned yet (e.g. just created, next poll will include it).
          const { sessions: local } = useAppStore.getState()
          const localOnly = local.filter((s) => !serverIds.has(s.id))

          setSessions([...localOnly, ...server] as typeof local)
        })
        .catch(() => {})
    }, 5000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [baseUrl, setSessions])

  // Lazy create: "New Chat" only resets to welcome screen;
  // the actual session is created when the user sends the first message.
  const handleNewChat = useCallback(() => {
    // If already on the welcome screen (no active session), nothing to do
    if (!activeSessionId) return

    setActiveSession(null)
    onSelectSession('')
  }, [activeSessionId, setActiveSession, onSelectSession])

  const handleOpenFolder = useCallback(async () => {
    const picked = await pickDirectory()
    if (picked) {
      // Just remember the directory; session will be created on first message send
      localStorage.setItem('miniclaw:last-working-directory', picked)
      setActiveSession(null)
      onSelectSession('')
    }
  }, [pickDirectory, setActiveSession, onSelectSession])

  // Stage a project group for deletion (opens confirm dialog)
  const requestDeleteProject = useCallback(
    (e: React.MouseEvent, dir: string) => {
      e.stopPropagation()
      const count = sessions.filter((s) => (s.working_directory || '') === dir).length
      const name = dir.split('/').filter(Boolean).pop() || dir
      setPending({ type: 'project', dir, name, count })
    },
    [sessions],
  )

  // Execute the confirmed deletion
  const executeDelete = useCallback(async () => {
    if (!pending || !baseUrl) {
      setPending(null)
      return
    }
    if (pending.type === 'session') {
      try {
        await fetch(`${baseUrl}/sessions/${pending.id}`, { method: 'DELETE' })
        removeSession(pending.id)
      } catch {
        // error
      }
    } else {
      const toDelete = sessions.filter((s) => (s.working_directory || '') === pending.dir)
      for (const s of toDelete) {
        try {
          await fetch(`${baseUrl}/sessions/${s.id}`, { method: 'DELETE' })
          removeSession(s.id)
        } catch {
          // continue
        }
      }
    }
    setPending(null)
  }, [pending, baseUrl, sessions, removeSession])

  const handleCreateInProject = useCallback(
    (e: React.MouseEvent, dir: string) => {
      e.stopPropagation()
      // Remember the target directory; session created on first message send
      localStorage.setItem('miniclaw:last-working-directory', dir)
      setActiveSession(null)
      onSelectSession('')
    },
    [setActiveSession, onSelectSession],
  )

  // Copy session ID to clipboard with toast feedback
  const handleCopyId = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      toast.success('已复制会话 ID')
    } catch {
      toast.error('复制失败')
    }
  }, [])

  const toggleGroup = useCallback((dir: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }, [])

  const filtered = sessions.filter(
    (s) => !search || s.title.toLowerCase().includes(search.toLowerCase()),
  )
  const groups = groupByProject(filtered)
  const isSearching = search.length > 0

  if (!open) return null

  return (
    <TooltipProvider delayDuration={200}>
      <aside className="flex h-full w-60 shrink-0 flex-col overflow-hidden bg-[var(--sidebar)]/80 backdrop-blur-xl border-r border-[var(--sidebar-border)]">
        {/* New Chat + Open Folder — top-aligned with NavRail logo */}
        <div className="flex items-center gap-2 px-3 pb-2 pt-7">
          <button
            onClick={handleNewChat}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 h-8 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <Plus size={14} />
            新对话
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleOpenFolder}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
              >
                <FolderOpen size={14} />
              </button>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent
                side="bottom"
                className="z-50 rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-xs text-white dark:text-zinc-900"
              >
                打开项目文件夹
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
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
            groups.map((group) => {
              const isCollapsed = !isSearching && group.dir && collapsed.has(group.dir)
              const dirName = group.dir
                ? group.dir.split('/').filter(Boolean).pop() || group.dir
                : ''

              return (
                <div key={group.dir || '__none'} className="mt-1 first:mt-0">
                  {/* Project folder header */}
                  {group.dir && (
                    <div
                      className="group/folder flex items-center gap-1 px-1 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 cursor-pointer"
                      onClick={() => toggleGroup(group.dir)}
                    >
                      {isCollapsed ? (
                        <ChevronRight
                          size={12}
                          className="text-[var(--muted-foreground)] shrink-0"
                        />
                      ) : (
                        <ChevronDown
                          size={12}
                          className="text-[var(--muted-foreground)] shrink-0"
                        />
                      )}
                      <span
                        className="text-[11px] font-medium text-[var(--muted-foreground)] truncate flex-1"
                        title={group.dir}
                      >
                        {dirName}
                      </span>
                      {/* Hover actions */}
                      <div className="opacity-0 group-hover/folder:opacity-100 flex items-center gap-0.5 shrink-0 transition-all">
                        <button
                          onClick={(e) => handleCreateInProject(e, group.dir)}
                          className="flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-[var(--sidebar-accent-foreground)] hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                          title="在此项目中新建会话"
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          onClick={(e) => requestDeleteProject(e, group.dir)}
                          className="flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          title="删除此项目的所有会话"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Session items */}
                  {!isCollapsed && (
                    <div className="mt-0.5 flex flex-col gap-0.5">
                      {group.sessions.map((session) => {
                        const isActive = activeSessionId === session.id
                        const isHovered = hovered === session.id

                        return (
                          <div
                            key={session.id}
                            className="group/item relative"
                            onMouseEnter={() => setHovered(session.id)}
                            onMouseLeave={() => {
                              if (!menuOpenId) setHovered(null)
                            }}
                          >
                            <button
                              onClick={() => {
                                setActiveSession(session.id)
                                onSelectSession(session.id)
                              }}
                              className={cn(
                                'w-full text-left px-2 py-1.5 rounded-lg text-xs truncate transition-colors pr-7',
                                isActive
                                  ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] font-medium'
                                  : 'text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)]',
                              )}
                            >
                              {session.title || 'New Chat'}
                            </button>
                            {(isHovered || isActive) && (
                              <DropdownMenu.Root
                                onOpenChange={(isOpen) => {
                                  setMenuOpenId(isOpen ? session.id : null)
                                  if (!isOpen) setHovered(null)
                                }}
                              >
                                <DropdownMenu.Trigger asChild>
                                  <button
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                                  >
                                    <MoreHorizontal size={14} />
                                  </button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Portal>
                                  <DropdownMenu.Content
                                    side="right"
                                    align="start"
                                    sideOffset={4}
                                    className="z-50 min-w-[140px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
                                  >
                                    <DropdownMenu.Item
                                      onSelect={() => handleCopyId(session.id)}
                                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer outline-none hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 transition-colors"
                                    >
                                      <Copy size={12} />
                                      复制会话 ID
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Separator className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
                                    <DropdownMenu.Item
                                      onSelect={() =>
                                        setPending({
                                          type: 'session',
                                          id: session.id,
                                          title: session.title || 'New Chat',
                                        })
                                      }
                                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-red-500 cursor-pointer outline-none hover:bg-red-50 dark:hover:bg-red-900/20 focus:bg-red-50 dark:focus:bg-red-900/20 transition-colors"
                                    >
                                      <Trash2 size={12} />
                                      删除会话
                                    </DropdownMenu.Item>
                                  </DropdownMenu.Content>
                                </DropdownMenu.Portal>
                              </DropdownMenu.Root>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Version footer */}
        <div className="shrink-0 px-3 py-2 text-center">
          <span className="text-[10px] text-[var(--muted-foreground)]/40">v0.1.0</span>
        </div>
      </aside>

      {/* Delete confirmation dialog (Radix Dialog, not window.confirm) */}
      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">确认删除</DialogTitle>
            <DialogDescription className="pt-1">
              {pending?.type === 'session'
                ? `确定要删除会话「${pending.title}」吗？此操作不可撤销。`
                : pending?.type === 'project'
                  ? `确定要删除「${pending.name}」下的 ${pending.count} 个会话吗？此操作不可撤销。`
                  : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <button
              onClick={() => setPending(null)}
              className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              取消
            </button>
            <button
              onClick={executeDelete}
              className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              删除
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
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
