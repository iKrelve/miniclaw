/**
 * MessageList — Renders chat messages and streaming text
 */

import { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';
import type { StreamMessage } from '../../hooks/useSSEStream';

interface Message {
  id: string;
  role: string;
  content: string;
}

interface MessageListProps {
  messages: Message[];
  streamingText: string;
  streamEvents: StreamMessage[];
  isStreaming: boolean;
}

export function MessageList({ messages, streamingText, streamEvents, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            'max-w-[85%] rounded-2xl px-4 py-3',
            msg.role === 'user'
              ? 'ml-auto bg-blue-500 text-white'
              : 'mr-auto bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100',
          )}
        >
          <div className="text-sm whitespace-pre-wrap break-words">{msg.content}</div>
        </div>
      ))}

      {/* Tool events */}
      {streamEvents
        .filter((e) => e.type === 'tool_use')
        .map((e, i) => {
          const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
          return (
            <div key={`tool-${i}`} className="mx-auto max-w-[85%] rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-300">
                🔧 {(data as Record<string, unknown>).name as string}
              </div>
            </div>
          );
        })}

      {/* Streaming text */}
      {isStreaming && streamingText && (
        <div className="mr-auto max-w-[85%] rounded-2xl px-4 py-3 bg-zinc-100 dark:bg-zinc-800">
          <div className="text-sm whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-100">
            {streamingText}
            <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-0.5" />
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isStreaming && !streamingText && (
        <div className="mr-auto max-w-[85%] rounded-2xl px-4 py-3 bg-zinc-100 dark:bg-zinc-800">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
