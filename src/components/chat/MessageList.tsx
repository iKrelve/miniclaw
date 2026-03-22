/**
 * MessageList — Renders chat messages with Markdown, tool calls, and permission prompts.
 */

import { useEffect, useRef, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolCallBlock } from './ToolCallBlock';
import { PermissionPrompt } from './PermissionPrompt';
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
  onPermissionAllow?: (id: string) => void;
  onPermissionDeny?: (id: string) => void;
}

export function MessageList({
  messages,
  streamingText,
  streamEvents,
  isStreaming,
  onPermissionAllow,
  onPermissionDeny,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, streamEvents]);

  // Parse tool events into structured data
  const toolUses = useMemo(() => {
    const uses: Array<{ id: string; name: string; input: unknown }> = [];
    for (const e of streamEvents) {
      if (e.type === 'tool_use') {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        uses.push(data as { id: string; name: string; input: unknown });
      }
    }
    return uses;
  }, [streamEvents]);

  const toolResults = useMemo(() => {
    const results = new Map<string, { tool_use_id: string; content: string; is_error?: boolean }>();
    for (const e of streamEvents) {
      if (e.type === 'tool_result') {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        const d = data as { tool_use_id: string; content: string; is_error?: boolean };
        results.set(d.tool_use_id, d);
      }
    }
    return results;
  }, [streamEvents]);

  const permissionRequests = useMemo(() => {
    const reqs: Array<{ id: string; tool_name: string; description: string; input: unknown }> = [];
    for (const e of streamEvents) {
      if (e.type === 'permission_request') {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        reqs.push(data as { id: string; tool_name: string; description: string; input: unknown });
      }
    }
    return reqs;
  }, [streamEvents]);

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
          {msg.role === 'assistant' ? (
            <MarkdownRenderer content={msg.content} />
          ) : (
            <div className="text-sm whitespace-pre-wrap break-words">{msg.content}</div>
          )}
        </div>
      ))}

      {/* Tool calls */}
      {toolUses.map((tu) => (
        <div key={tu.id} className="max-w-[85%] mr-auto">
          <ToolCallBlock toolUse={tu} toolResult={toolResults.get(tu.id)} />
        </div>
      ))}

      {/* Permission requests */}
      {permissionRequests.map((pr) => (
        <div key={pr.id} className="max-w-[85%] mr-auto">
          <PermissionPrompt
            request={pr}
            onAllow={onPermissionAllow || (() => {})}
            onDeny={onPermissionDeny || (() => {})}
          />
        </div>
      ))}

      {/* Streaming text with Markdown */}
      {isStreaming && streamingText && (
        <div className="mr-auto max-w-[85%] rounded-2xl px-4 py-3 bg-zinc-100 dark:bg-zinc-800">
          <MarkdownRenderer content={streamingText} />
          <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-0.5" />
        </div>
      )}

      {/* Loading indicator */}
      {isStreaming && !streamingText && toolUses.length === 0 && (
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