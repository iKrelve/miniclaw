/**
 * MessageInput — Chat input textarea with send button
 */

import { useState, useRef, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';
import { cn } from '../../lib/utils';

interface MessageInputProps {
  onSend: (content: string) => void;
  onInterrupt?: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export function MessageInput({ onSend, onInterrupt, isStreaming, disabled }: MessageInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        onInterrupt?.();
      } else {
        handleSend();
      }
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  return (
    <div className="flex items-end gap-2 p-4 border-t border-zinc-200 dark:border-zinc-800">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder="发送消息... (Enter 发送, Shift+Enter 换行)"
        disabled={disabled}
        rows={1}
        className={cn(
          'flex-1 resize-none rounded-xl px-4 py-3',
          'bg-zinc-100 dark:bg-zinc-800',
          'border border-zinc-200 dark:border-zinc-700',
          'text-sm text-zinc-900 dark:text-zinc-100',
          'placeholder:text-zinc-400',
          'focus:outline-none focus:ring-2 focus:ring-blue-500/50',
          'disabled:opacity-50',
        )}
      />
      <button
        onClick={isStreaming ? onInterrupt : handleSend}
        disabled={disabled || (!isStreaming && !value.trim())}
        className={cn(
          'flex items-center justify-center',
          'h-10 w-10 rounded-xl',
          'transition-colors',
          isStreaming
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-blue-500 text-white hover:bg-blue-600',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {isStreaming ? <Square size={16} /> : <Send size={16} />}
      </button>
    </div>
  );
}
