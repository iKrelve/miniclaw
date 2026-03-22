/**
 * NavRail — Narrow icon-only vertical navigation bar (CodePilot-aligned).
 *
 * Width: 56px. Radix Tooltip on each icon.
 * Top: Chat (toggles ChatListPanel) / Skills / Plugins
 * Bottom: Settings + connection status dot
 *
 * Interaction rules (matching CodePilot):
 * - Chat icon: if not on chat view → navigate to chat (which auto-opens list);
 *              if already on chat → pure toggle of ChatListPanel
 * - Other icons: navigate to that view (ChatListPanel auto-hides via AppShell)
 */

import { MessageSquare, Sparkles, Puzzle, Settings } from 'lucide-react'
import logo from '../../assets/logo.png'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
  TooltipPortal,
} from '@radix-ui/react-tooltip'
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
    <TooltipProvider delayDuration={200}>
      <aside className="flex w-14 shrink-0 flex-col items-center bg-[var(--sidebar)]/80 backdrop-blur-xl border-r border-[var(--sidebar-border)] pb-3 pt-7">
        {/* App logo — top-aligned with ChatListPanel "新对话" button */}
        <img src={logo} alt="小龙虾" className="w-7 h-7 rounded-lg mb-3" />

        {/* Main navigation icons */}
        <nav className="flex flex-1 flex-col items-center gap-1">
          {navItems.map((item) => {
            const isActive = item.id === 'chat' ? currentView === 'chat' : currentView === item.id

            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (item.togglesChatList) {
                        if (currentView !== 'chat') {
                          onNavigate('chat')
                          // AppShell.handleNavigate auto-opens ChatList
                        } else {
                          onToggleChatList()
                        }
                      } else {
                        onNavigate(item.id)
                      }
                    }}
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                      isActive
                        ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]'
                        : 'text-zinc-500 dark:text-zinc-400 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]',
                    )}
                  >
                    <item.icon size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipPortal>
                  <TooltipContent
                    side="right"
                    className="z-50 rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-xs text-white dark:text-zinc-900"
                  >
                    {item.label}
                  </TooltipContent>
                </TooltipPortal>
              </Tooltip>
            )
          })}
        </nav>

        {/* Bottom: connection status + Settings */}
        <div className="mt-auto flex flex-col items-center gap-2">
          {/* Connection status dot */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex h-8 w-8 items-center justify-center">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    error ? 'bg-red-500' : ready ? 'bg-green-500' : 'bg-yellow-500 animate-pulse',
                  )}
                />
              </div>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent
                side="right"
                className="z-50 rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-xs text-white dark:text-zinc-900"
              >
                {error || (ready ? '已连接' : '连接中...')}
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>

          {/* Settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onNavigate('settings')}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                  currentView === 'settings'
                    ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]',
                )}
              >
                <Settings size={16} />
              </button>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent
                side="right"
                className="z-50 rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-xs text-white dark:text-zinc-900"
              >
                设置
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}
