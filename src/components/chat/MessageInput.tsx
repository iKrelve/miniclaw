/**
 * MessageInput — Card-style chat input (inspired by CodePilot's PromptInput)
 *
 * A full-width card container with a resizable textarea and a footer toolbar
 * holding the send/stop button. Visually prominent so users immediately know
 * where to type.
 */

import { useState, useRef, type KeyboardEvent } from 'react'
import { Send, Square, CornerDownLeft } from 'lucide-react'
import { cn } from '../../lib/utils'

interface MessageInputProps {
  onSend: (content: string) => void
  onInterrupt?: () => void
  isStreaming: boolean
  disabled?: boolean
}

export function MessageInput({ onSend, onInterrupt, isStreaming, disabled }: MessageInputProps) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isStreaming) {
        onInterrupt?.()
      } else {
        handleSend()
      }
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 240)}px`
    }
  }

  const canSend = !disabled && value.trim().length > 0

  return (
    <div className="px-4 pb-4 pt-2">
      <div
        className={cn(
          'relative flex flex-col',
          'rounded-2xl border shadow-sm',
          'bg-white dark:bg-zinc-900',
          'transition-shadow',
          focused
            ? 'border-blue-400 dark:border-blue-500 shadow-blue-100/50 dark:shadow-blue-900/30 shadow-md'
            : 'border-zinc-200 dark:border-zinc-700',
        )}
      >
        {/* Textarea area */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="给小龙虾发送消息..."
          disabled={disabled}
          rows={3}
          className={cn(
            'w-full resize-none',
            'rounded-t-2xl border-0 bg-transparent',
            'px-4 pt-4 pb-2',
            'text-sm text-zinc-900 dark:text-zinc-100',
            'placeholder:text-zinc-400 dark:placeholder:text-zinc-500',
            'focus:outline-none',
            'disabled:opacity-50',
            'min-h-[80px] max-h-[240px]',
          )}
        />

        {/* Footer toolbar */}
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          {/* Left: hints */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
            <CornerDownLeft size={12} />
            <span>{isStreaming ? '按 Enter 停止' : 'Enter 发送，Shift+Enter 换行'}</span>
          </div>

          {/* Right: send / stop button */}
          <button
            onClick={isStreaming ? onInterrupt : handleSend}
            disabled={disabled || (!isStreaming && !canSend)}
            className={cn(
              'flex items-center justify-center gap-1.5',
              'h-8 rounded-lg px-3',
              'text-xs font-medium',
              'transition-all duration-150',
              isStreaming
                ? 'bg-red-500 text-white hover:bg-red-600 active:scale-95'
                : canSend
                  ? 'bg-blue-500 text-white hover:bg-blue-600 active:scale-95'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isStreaming ? (
              <>
                <Square size={12} />
                <span>停止</span>
              </>
            ) : (
              <>
                <Send size={12} />
                <span>发送</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
