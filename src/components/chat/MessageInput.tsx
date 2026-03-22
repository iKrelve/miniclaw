/**
 * MessageInput — Card-style chat input with model selector in footer toolbar.
 *
 * A full-width card container with a resizable textarea and a footer toolbar
 * holding model selector + send/stop button. Aligned with CodePilot's
 * PromptInput pattern where model selection is inside the input area.
 */

import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { Send, Square, CornerDownLeft, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useSidecar } from '../../hooks/useSidecar'

interface CatalogModel {
  id: string
  name: string
  provider: string
}

interface MessageInputProps {
  onSend: (content: string) => void
  onInterrupt?: () => void
  isStreaming: boolean
  disabled?: boolean
  /** Currently selected model ID */
  currentModel: string
  /** Called when user picks a different model */
  onModelChange: (modelId: string) => void
}

export function MessageInput({
  onSend,
  onInterrupt,
  isStreaming,
  disabled,
  currentModel,
  onModelChange,
}: MessageInputProps) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Model dropdown state
  const { baseUrl } = useSidecar()
  const [models, setModels] = useState<CatalogModel[]>([])
  const [modelOpen, setModelOpen] = useState(false)
  const modelRef = useRef<HTMLDivElement>(null)

  // Fetch models
  useEffect(() => {
    if (!baseUrl) return
    fetch(`${baseUrl}/providers/models`)
      .then((res) => res.json())
      .then((data) => setModels(data.models || []))
      .catch(() => {})
  }, [baseUrl])

  // Close model dropdown on click outside
  useEffect(() => {
    if (!modelOpen) return
    const handler = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [modelOpen])

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

  const handleModelSelect = (modelId: string) => {
    onModelChange(modelId)
    setModelOpen(false)
  }

  const canSend = !disabled && value.trim().length > 0
  const currentModelObj = models.find((m) => m.id === currentModel)

  // Group models by provider
  const grouped = models.reduce<Record<string, CatalogModel[]>>((acc, m) => {
    const key = m.provider || 'default'
    ;(acc[key] ??= []).push(m)
    return acc
  }, {})

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
          {/* Left: model selector + hints */}
          <div className="flex items-center gap-3">
            {/* Model selector button */}
            <div ref={modelRef} className="relative">
              <button
                onClick={() => setModelOpen(!modelOpen)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 transition-colors font-mono"
              >
                <span className="truncate max-w-[120px]">
                  {currentModelObj?.name || currentModel || 'Select model'}
                </span>
                <ChevronDown
                  size={10}
                  className={cn('transition-transform', modelOpen && 'rotate-180')}
                />
              </button>

              {modelOpen && (
                <div className="absolute left-0 bottom-full mb-1 z-50 w-64 max-h-72 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg">
                  {models.length === 0 && (
                    <div className="px-3 py-4 text-xs text-zinc-400 text-center">
                      无可用模型（请先在设置中配置 Provider）
                    </div>
                  )}
                  {Object.entries(grouped).map(([provider, providerModels]) => (
                    <div key={provider}>
                      <div className="px-3 py-1.5 text-[10px] uppercase font-medium text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                        {provider}
                      </div>
                      {providerModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => handleModelSelect(m.id)}
                          className={cn(
                            'w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-between',
                            m.id === currentModel &&
                              'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
                          )}
                        >
                          <span>{m.name}</span>
                          {m.id === currentModel && (
                            <span className="text-blue-500 text-xs">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Keyboard hints */}
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
              <CornerDownLeft size={12} />
              <span>{isStreaming ? '按 Enter 停止' : 'Enter 发送'}</span>
            </div>
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
