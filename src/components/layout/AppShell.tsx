/**
 * AppShell — Main application layout (CodePilot-aligned three-column).
 *
 * NavRail (56px icons) | ChatListPanel (240px, collapsible) | [TopBar + Content]
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
    // Ensure we're on the chat view when selecting a session
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
      {/* Column 1: NavRail (icon navigation) */}
      <NavRail
        currentView={currentView}
        onNavigate={handleNavigate}
        onToggleChatList={handleToggleChatList}
      />

      {/* Column 2: ChatListPanel (collapsible session list) */}
      <ChatListPanel open={chatListOpen} onSelectSession={handleSelectSession} />

      {/* Column 3: Main content area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <UnifiedTopBar currentView={currentView} />
        <UpdateBanner />
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <main className="relative flex-1 overflow-hidden flex flex-col">{renderContent()}</main>
          </div>
        </div>
      </div>
    </div>
  )
}
