/**
 * NavRail — Narrow icon-only vertical navigation bar (CodePilot-aligned).
 *
 * Width: 56px. Icons with tooltips.
 * Top: Chat (toggles ChatListPanel) / Skills / Plugins
 * Bottom: Settings + connection status dot
 */

import { MessageSquare, Sparkles, Puzzle, Settings } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useSidecar } from '../../hooks/useSidecar'

interface NavRailProps {
  currentView: string
  onNavigate: (view: string) => void
  onToggleChatList: () => void
}

const navItems: Array<{
  id: string
  icon: typeof MessageSquare
  label: string
  togglesChatList?: boolean
}> = [
  { id: 'chat', icon: MessageSquare, label: '对话', togglesChatList: true },
  { id: 'skills', icon: Sparkles, label: '技能' },
  { id: 'plugins', icon: Puzzle, label: '插件' },
]

export function NavRail({ currentView, onNavigate, onToggleChatList }: NavRailProps) {
  const { ready, error } = useSidecar()

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center bg-[var(--sidebar)]/80 backdrop-blur-xl border-r border-[var(--sidebar-border)] pb-3 pt-10">
      {/* Main navigation icons */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map((item) => {
          const isActive = item.id === 'chat' ? currentView === 'chat' : currentView === item.id

          return (
            <div key={item.id} className="group relative">
              <button
                onClick={() => {
                  if (item.togglesChatList) {
                    // Chat icon toggles the chat list panel + navigates to chat
                    if (currentView !== 'chat') {
                      onNavigate('chat')
                    }
                    onToggleChatList()
                  } else {
                    onNavigate(item.id)
                  }
                }}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                  isActive
                    ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]',
                )}
              >
                <item.icon size={16} />
              </button>
              {/* Tooltip */}
              <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-xs text-white dark:text-zinc-900 opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
                {item.label}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Bottom: Settings + connection status */}
      <div className="mt-auto flex flex-col items-center gap-2">
        {/* Connection status dot */}
        <div className="flex h-8 w-8 items-center justify-center">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              error ? 'bg-red-500' : ready ? 'bg-green-500' : 'bg-yellow-500 animate-pulse',
            )}
            title={error || (ready ? '已连接' : '连接中...')}
          />
        </div>

        {/* Settings */}
        <div className="group relative">
          <button
            onClick={() => onNavigate('settings')}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
              currentView === 'settings'
                ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]',
            )}
          >
            <Settings size={16} />
          </button>
          <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-xs text-white dark:text-zinc-900 opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
            设置
          </div>
        </div>
      </div>
    </aside>
  )
}
