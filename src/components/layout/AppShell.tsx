/**
 * AppShell — Main application layout with sidebar, update banner, and content area.
 */

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { UpdateBanner } from './UpdateBanner';
import { ChatView } from '../chat/ChatView';
import { SettingsView } from '../settings/SettingsView';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { GitPanel } from '../git/GitPanel';
import { FilePanel } from '../files/FilePanel';
import { McpPanel } from '../plugins/McpPanel';
import { SkillsPanel } from '../skills/SkillsPanel';

export function AppShell() {
  const [currentView, setCurrentView] = useState('chat');

  const renderContent = () => {
    switch (currentView) {
      case 'chat': return <ChatView />;
      case 'settings': return <SettingsView />;
      case 'terminal': return <TerminalPanel />;
      case 'git': return <GitPanel />;
      case 'files': return <FilePanel />;
      case 'plugins': return <McpPanel />;
      case 'skills': return <SkillsPanel />;
      default: return <ChatView />;
    }
  };

  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <Sidebar onNavigate={setCurrentView} currentView={currentView} />
      <div className="flex-1 flex flex-col min-h-0">
        <UpdateBanner />
        {renderContent()}
      </div>
    </div>
  );
}