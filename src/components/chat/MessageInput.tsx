/**
 * MessageInput — Card-style chat input with model selector in footer toolbar.
 *
 * Fetches provider model groups from sidecar and displays models grouped by
 * provider. On selection, passes both providerId and modelId to the parent.
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type ReactNode } from 'react'
import { Send, Square, ChevronDown, X, Sparkles } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useSidecar } from '../../hooks/useSidecar'
import type { ProviderModelGroup } from '../../../shared/types'
import { SlashCommandPopover, type SelectedSkill } from './SlashCommandPopover'

interface MessageInputProps {
  onSend: (content: string, opts?: { systemPromptAppend?: string }) => void
  onInterrupt?: () => void
  isStreaming: boolean
  disabled?: boolean
  /** Currently selected model ID */
  currentModel: string
  /** Currently selected provider ID */
  currentProviderId: string
  /** Called when user picks a different model */
  onModelChange: (providerId: string, modelId: string) => void
  /** Optional slot rendered to the right of model selector (e.g. permission selector) */
  extraToolbar?: ReactNode
}

// Default fallback when API is unavailable
const FALLBACK_GROUPS: ProviderModelGroup[] = [
  {
    provider_id: 'env',
    provider_name: 'Claude Code',
    provider_type: 'anthropic',
    models: [
      { value: 'sonnet', label: 'Sonnet 4.6' },
      { value: 'opus', label: 'Opus 4.6' },
      { value: 'haiku', label: 'Haiku 4.5' },
    ],
  },
]

export function MessageInput({
  onSend,
  onInterrupt,
  isStreaming,
  disabled,
  currentModel,
  currentProviderId,
  onModelChange,
  extraToolbar,
}: MessageInputProps) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Slash command state
  const [slashVisible, setSlashVisible] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<SelectedSkill | null>(null)

  // Model dropdown state
  const { baseUrl } = useSidecar()
  const [groups, setGroups] = useState<ProviderModelGroup[]>(FALLBACK_GROUPS)
  const [modelOpen, setModelOpen] = useState(false)
  const modelRef = useRef<HTMLDivElement>(null)

  // Fetch provider model groups from sidecar
  const fetchGroups = useCallback(() => {
    if (!baseUrl) return
    fetch(`${baseUrl}/providers/models`)
      .then((res) => res.json())
      .then((data) => {
        if (data.groups && data.groups.length > 0) {
          setGroups(data.groups)
          // Auto-select the default provider if user hasn't chosen one yet
          const defaultPid = data.default_provider_id as string
          if (defaultPid && !currentProviderId) {
            const group = (data.groups as ProviderModelGroup[]).find(
              (g) => g.provider_id === defaultPid,
            )
            if (group && group.models.length > 0) {
              onModelChange(defaultPid, group.models[0].value)
            }
          }
        }
      })
      .catch(() => {})
  }, [baseUrl, currentProviderId, onModelChange])

  // Fetch on mount
  useEffect(() => fetchGroups(), [fetchGroups])

  // Re-fetch after streaming ends — SDK captures real models during first chat
  const prevStreaming = useRef(false)
  useEffect(() => {
    if (prevStreaming.current && !isStreaming) {
      fetchGroups()
    }
    prevStreaming.current = isStreaming
  }, [isStreaming, fetchGroups])

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
    const opts = selectedSkill?.content ? { systemPromptAppend: selectedSkill.content } : undefined
    onSend(trimmed, opts)
    setValue('')
    setSelectedSkill(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Let slash popover handle navigation keys
    if (slashVisible && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
      return // SlashCommandPopover handles these via window listener
    }
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

  // Detect "/" at the start of input to trigger slash popover
  const handleValueChange = (newVal: string) => {
    setValue(newVal)
    if (newVal.startsWith('/')) {
      setSlashVisible(true)
      setSlashQuery(newVal.slice(1))
    } else {
      setSlashVisible(false)
      setSlashQuery('')
    }
  }

  const handleSlashSelect = (skill: SelectedSkill) => {
    setSelectedSkill(skill)
    setValue('') // Clear the slash command text
    setSlashVisible(false)
    setSlashQuery('')
    textareaRef.current?.focus()
  }

  const handleModelSelect = (providerId: string, modelId: string) => {
    onModelChange(providerId, modelId)
    setModelOpen(false)
  }

  const canSend = !disabled && value.trim().length > 0

  // Find current model label for display
  const currentLabel = findModelLabel(groups, currentProviderId, currentModel)

  return (
    <div className="bg-white/80 dark:bg-zinc-950/80 backdrop-blur-lg px-4 pb-4 pt-2">
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
        {/* Slash command popover */}
        <SlashCommandPopover
          query={slashQuery}
          onSelect={handleSlashSelect}
          onClose={() => setSlashVisible(false)}
          visible={slashVisible}
        />

        {/* Skill badge */}
        {selectedSkill && (
          <div className="flex items-center gap-1.5 px-4 pt-3 pb-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Sparkles size={10} />/{selectedSkill.name}
              <button
                onClick={() => setSelectedSkill(null)}
                className="ml-0.5 hover:text-amber-900 dark:hover:text-amber-100"
              >
                <X size={10} />
              </button>
            </span>
          </div>
        )}

        {/* Textarea area */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={
            selectedSkill ? `使用 /${selectedSkill.name} 技能发送消息...` : '给小龙虾发送消息...'
          }
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
                <span className="truncate max-w-[120px]">{currentLabel}</span>
                <ChevronDown
                  size={10}
                  className={cn('transition-transform', modelOpen && 'rotate-180')}
                />
              </button>

              {modelOpen && (
                <div className="absolute left-0 bottom-full mb-1 z-50 w-64 max-h-72 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg">
                  {groups.length === 0 && (
                    <div className="px-3 py-4 text-xs text-zinc-400 text-center">
                      无可用模型（请先在设置中配置 Provider）
                    </div>
                  )}
                  {groups.map((group) => (
                    <div key={group.provider_id}>
                      <div className="px-3 py-1.5 text-[10px] uppercase font-medium text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                        {group.provider_name}
                      </div>
                      {group.models.map((m) => {
                        const active =
                          m.value === currentModel && group.provider_id === currentProviderId
                        return (
                          <button
                            key={`${group.provider_id}-${m.value}`}
                            onClick={() => handleModelSelect(group.provider_id, m.value)}
                            className={cn(
                              'w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-between',
                              active &&
                                'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
                            )}
                          >
                            <span>{m.label}</span>
                            {active && <span className="text-blue-500 text-xs">✓</span>}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Extra toolbar slot (permission selector etc.) */}
            {extraToolbar}
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
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : canSend
                  ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-sm'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed',
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

/** Find the display label for the current model in the groups. */
function findModelLabel(groups: ProviderModelGroup[], providerId: string, modelId: string): string {
  // Try exact match (provider + model)
  const group = groups.find((g) => g.provider_id === providerId)
  if (group) {
    const model = group.models.find((m) => m.value === modelId)
    if (model) return model.label
  }
  // Fallback: search all groups for the model
  for (const g of groups) {
    const model = g.models.find((m) => m.value === modelId)
    if (model) return model.label
  }
  return modelId || 'Select model'
}
