/**
 * AppShell — Main application layout with sidebar and content area
 */

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { ChatView } from '../chat/ChatView';
import { SettingsView } from '../settings/SettingsView';

export function AppShell() {
  const [currentView, setCurrentView] = useState('chat');

  const renderContent = () => {
    switch (currentView) {
      case 'chat':
        return <ChatView />;
      case 'settings':
        return <SettingsView />;
      case 'files':
        return (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            <div className="text-center">
              <div className="text-4xl mb-2">📁</div>
              <p>文件浏览（开发中）</p>
            </div>
          </div>
        );
      case 'plugins':
        return (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            <div className="text-center">
              <div className="text-4xl mb-2">🧩</div>
              <p>MCP 插件管理（开发中）</p>
            </div>
          </div>
        );
      case 'skills':
        return (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            <div className="text-center">
              <div className="text-4xl mb-2">✨</div>
              <p>技能市场（开发中）</p>
            </div>
          </div>
        );
      default:
        return <ChatView />;
    }
  };

  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <Sidebar onNavigate={setCurrentView} currentView={currentView} />
      <div className="flex-1 flex flex-col min-h-0">
        {renderContent()}
      </div>
    </div>
  );
}
