/**
 * ChatView — Main chat interface combining message list, input, and model selector.
 */

import { useEffect, useCallback } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { useSSEStream } from '../../hooks/useSSEStream';
import { useAppStore } from '../../stores';
import { useSidecar } from '../../hooks/useSidecar';
import { Toaster, toast } from '../ui/toast';

export function ChatView() {
  const { baseUrl, ready } = useSidecar();
  const { activeSessionId, messages, setMessages, addMessage, sessions } = useAppStore();
  const { streamingText, isStreaming, messages: streamEvents, send, interrupt, clear } = useSSEStream();

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Load messages when session changes
  useEffect(() => {
    if (!baseUrl || !activeSessionId) return;
    clear();
    fetch(`${baseUrl}/sessions/${activeSessionId}/messages`)
      .then((res) => res.json())
      .then((data) => setMessages(data.messages || []))
      .catch(() => setMessages([]));
  }, [baseUrl, activeSessionId, setMessages, clear]);

  const handleSend = useCallback(
    (content: string) => {
      if (!baseUrl || !activeSessionId) return;

      addMessage({
        id: `temp-${Date.now()}`,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      });

      send(baseUrl, activeSessionId, content, {
        model: activeSession?.model,
        mode: activeSession?.mode,
      });
    },
    [baseUrl, activeSessionId, activeSession, send, addMessage],
  );

  const handleInterrupt = useCallback(() => {
    if (!baseUrl || !activeSessionId) return;
    interrupt(baseUrl, activeSessionId);
  }, [baseUrl, activeSessionId, interrupt]);

  // Permission handlers
  const handlePermissionAllow = useCallback(
    (permissionId: string) => {
      if (!baseUrl) return;
      fetch(`${baseUrl}/chat/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_id: permissionId, allow: true }),
      }).catch(() => toast('权限响应发送失败'));
    },
    [baseUrl],
  );

  const handlePermissionDeny = useCallback(
    (permissionId: string) => {
      if (!baseUrl) return;
      fetch(`${baseUrl}/chat/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_id: permissionId, allow: false }),
      }).catch(() => toast('权限响应发送失败'));
    },
    [baseUrl],
  );

  // When stream completes, add assistant message to local state
  useEffect(() => {
    if (!isStreaming && streamingText) {
      addMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: streamingText,
        created_at: new Date().toISOString(),
      });
      clear();
    }
  }, [isStreaming, streamingText, addMessage, clear]);

  if (!activeSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-6xl">🦞</div>
          <h2 className="text-2xl font-semibold text-zinc-700 dark:text-zinc-300">小龙虾</h2>
          <p className="text-zinc-500 dark:text-zinc-400">选择一个会话或创建新对话开始</p>
        </div>
        <Toaster position="bottom-right" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Session header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
          {activeSession?.title || 'New Chat'}
        </div>
        {activeSession?.model && (
          <span className="text-xs text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
            {activeSession.model}
          </span>
        )}
      </div>

      <MessageList
        messages={messages}
        streamingText={streamingText}
        streamEvents={streamEvents}
        isStreaming={isStreaming}
        onPermissionAllow={handlePermissionAllow}
        onPermissionDeny={handlePermissionDeny}
      />
      <MessageInput
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        isStreaming={isStreaming}
        disabled={!ready}
      />
      <Toaster position="bottom-right" />
    </div>
  );
}