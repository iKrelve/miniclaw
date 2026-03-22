/**
 * AppShell — Main application layout (CodePilot-aligned three-column).
 *
 * NavRail (56px icons) | ChatListPanel (240px, collapsible, chat-only) | [TopBar + Content]
 *
 * Key interaction rules (matching CodePilot):
 * - ChatListPanel is only shown when currentView === 'chat'
 * - Clicking Chat icon in NavRail: if not on chat, navigate + open list; if on chat, toggle list
 * - Clicking any other nav icon: switch view (ChatListPanel auto-hides)
 */

import { useState, useCallback } from 'react'
import { NavRail } from './NavRail'
import { ChatListPanel } from './ChatListPanel'
import { UnifiedTopBar } from './UnifiedTopBar'
import { UpdateBanner } from './UpdateBanner'
import { ChatView } from '../chat/ChatView'
import { SettingsView } from '../settings/SettingsView'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { GitPanel } from '../git/GitPanel'
import { FilePanel } from '../files/FilePanel'
import { McpPanel } from '../plugins/McpPanel'
import { SkillsPanel } from '../skills/SkillsPanel'

export function AppShell() {
  const [currentView, setCurrentView] = useState('chat')
  const [chatListOpen, setChatListOpen] = useState(true)

  const isChatView = currentView === 'chat'

  const handleNavigate = useCallback((view: string) => {
    setCurrentView(view)
    // Auto-open chat list when navigating to chat
    if (view === 'chat') {
      setChatListOpen(true)
    }
  }, [])

  const handleToggleChatList = useCallback(() => {
    setChatListOpen((prev) => !prev)
  }, [])

  const handleSelectSession = useCallback(() => {
    setCurrentView('chat')
  }, [])

  const renderContent = () => {
    switch (currentView) {
      case 'chat':
        return <ChatView />
      case 'settings':
        return <SettingsView />
      case 'terminal':
        return <TerminalPanel />
      case 'git':
        return <GitPanel />
      case 'files':
        return <FilePanel />
      case 'plugins':
        return <McpPanel />
      case 'skills':
        return <SkillsPanel />
      default:
        return <ChatView />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <NavRail
        currentView={currentView}
        onNavigate={handleNavigate}
        onToggleChatList={handleToggleChatList}
      />

      {/* ChatListPanel only renders on Chat view */}
      {isChatView && <ChatListPanel open={chatListOpen} onSelectSession={handleSelectSession} />}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <UnifiedTopBar currentView={currentView} />
        <UpdateBanner />
        <main className="relative flex-1 overflow-hidden flex flex-col">{renderContent()}</main>
      </div>
    </div>
  )
}
