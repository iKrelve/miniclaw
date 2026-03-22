/**
 * ChatView — Main chat interface combining message list and input
 *
 * When no session is active, the input is still shown — sending a message
 * auto-creates a new session (matching CodePilot's UX).
 */

import { useEffect, useCallback } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { useSSEStream } from '../../hooks/useSSEStream';
import { useAppStore } from '../../stores';
import { useSidecar } from '../../hooks/useSidecar';

export function ChatView() {
  const { baseUrl, ready } = useSidecar();
  const { activeSessionId, messages, setMessages, addMessage, addSession, setActiveSession, sessions } = useAppStore();
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

      // Optimistically add user message
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

  // Auto-create session then send — used when no session is active
  const handleSendNew = useCallback(
    async (content: string) => {
      if (!baseUrl) return;

      try {
        const res = await fetch(`${baseUrl}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: content.slice(0, 50),
            working_directory: '~',
          }),
        });
        const data = await res.json();
        if (!data.session) return;

        const session = data.session;
        addSession(session);
        setActiveSession(session.id);

        // Optimistically add user message
        addMessage({
          id: `temp-${Date.now()}`,
          role: 'user',
          content,
          created_at: new Date().toISOString(),
        });

        send(baseUrl, session.id, content, {
          model: session.model,
          mode: session.mode,
        });
      } catch {
        // session creation failed — silently ignore
      }
    },
    [baseUrl, addSession, setActiveSession, addMessage, send],
  );

  const handleInterrupt = useCallback(() => {
    if (!baseUrl || !activeSessionId) return;
    interrupt(baseUrl, activeSessionId);
  }, [baseUrl, activeSessionId, interrupt]);

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
      <div className="flex-1 flex flex-col min-h-0">
        {/* Welcome area */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="text-6xl">🦞</div>
            <h2 className="text-2xl font-semibold text-zinc-700 dark:text-zinc-300">小龙虾</h2>
            <p className="text-zinc-500 dark:text-zinc-400">
              输入消息开始新对话
            </p>
          </div>
        </div>
        {/* Input always visible */}
        <MessageInput
          onSend={handleSendNew}
          isStreaming={false}
          disabled={!ready}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <MessageList
        messages={messages}
        streamingText={streamingText}
        streamEvents={streamEvents}
        isStreaming={isStreaming}
      />
      <MessageInput
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        isStreaming={isStreaming}
        disabled={!ready}
      />
    </div>
  );
}
