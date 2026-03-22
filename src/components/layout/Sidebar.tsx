/**
 * Sidebar — Session list with search, navigation, and context menu.
 */

import { useEffect, useCallback, useState } from 'react';
import { Plus, MessageSquare, Settings, FolderGit2, Puzzle, Sparkles, Terminal, FolderOpen, Search, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../stores';
import { useSidecar } from '../../hooks/useSidecar';
import { ConnectionStatus } from './ConnectionStatus';

interface SidebarProps {
  onNavigate: (view: string) => void;
  currentView: string;
}

export function Sidebar({ onNavigate, currentView }: SidebarProps) {
  const { baseUrl } = useSidecar();
  const { sessions, activeSessionId, setSessions, setActiveSession, addSession, removeSession } = useAppStore();
  const [search, setSearch] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  // Load sessions on mount
  useEffect(() => {
    if (!baseUrl) return;
    fetch(`${baseUrl}/sessions`)
      .then((res) => res.json())
      .then((data) => setSessions(data.sessions || []))
      .catch(() => {});
  }, [baseUrl, setSessions]);

  const handleNewChat = useCallback(async () => {
    if (!baseUrl) return;
    try {
      const res = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ working_directory: '~' }),
      });
      const data = await res.json();
      if (data.session) {
        addSession(data.session);
        setActiveSession(data.session.id);
        onNavigate('chat');
      }
    } catch {
      // error
    }
  }, [baseUrl, addSession, setActiveSession, onNavigate]);

  const handleDeleteSession = useCallback(async (id: string) => {
    if (!baseUrl) return;
    try {
      await fetch(`${baseUrl}/sessions/${id}`, { method: 'DELETE' });
      removeSession(id);
      setContextMenu(null);
    } catch {
      // error
    }
  }, [baseUrl, removeSession]);

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  const navItems = [
    { id: 'chat', icon: MessageSquare, label: '对话' },
    { id: 'files', icon: FolderOpen, label: '文件' },
    { id: 'git', icon: FolderGit2, label: 'Git' },
    { id: 'plugins', icon: Puzzle, label: '插件' },
    { id: 'skills', icon: Sparkles, label: '技能' },
    { id: 'terminal', icon: Terminal, label: '终端' },
    { id: 'settings', icon: Settings, label: '设置' },
  ];

  const filteredSessions = sessions.filter(
    (s) => !search || s.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="w-64 flex flex-col bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-xl">🦞</span>
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">小龙虾</span>
        </div>
        <button onClick={handleNewChat} className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors" title="新对话">
          <Plus size={18} className="text-zinc-600 dark:text-zinc-400" />
        </button>
      </div>

      {/* Navigation */}
      <div className="px-2 py-2 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              currentView === item.id
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800',
            )}
          >
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
      </div>

      {/* Session search */}
      <div className="px-3 pt-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索会话..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 placeholder:text-zinc-400"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="text-xs font-medium text-zinc-400 dark:text-zinc-500 px-3 py-1 uppercase">
          会话 ({filteredSessions.length})
        </div>
        {filteredSessions.map((session) => (
          <button
            key={session.id}
            onClick={() => { setActiveSession(session.id); onNavigate('chat'); }}
            onContextMenu={(e) => handleContextMenu(e, session.id)}
            className={cn(
              'w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors',
              activeSessionId === session.id
                ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800',
            )}
          >
            {session.title}
          </button>
        ))}
        {filteredSessions.length === 0 && (
          <p className="text-xs text-zinc-400 px-3 py-2">{search ? '未找到匹配' : '暂无会话'}</p>
        )}
      </div>

      {/* Connection status footer */}
      <ConnectionStatus />

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
    </div>
  );
}