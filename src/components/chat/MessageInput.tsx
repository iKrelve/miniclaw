/**
 * MessageInput — Card-style chat input with model selector in footer toolbar.
 *
 * Fetches provider model groups from sidecar and displays models grouped by
 * provider. On selection, passes both providerId and modelId to the parent.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import { Send, Square, ChevronDown, X, Sparkles, Plus, FileIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useSidecar } from '../../hooks/useSidecar'
import type { ProviderModelGroup, FileAttachment } from '../../../shared/types'
import { SlashCommandPopover, type SelectedSkill } from './SlashCommandPopover'

// ── Attachment types ─────────────────────────────────────────────────

interface AttachmentItem {
  id: string
  name: string
  type: string // MIME type
  size: number
  url: string // blob URL for preview
}

function isImage(type: string): boolean {
  return type.startsWith('image/')
}

async function blobUrlToBase64(url: string): Promise<string> {
  const res = await fetch(url)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.includes(',') ? result.split(',')[1] : result)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ── Props ────────────────────────────────────────────────────────────

interface MessageInputProps {
  onSend: (
    content: string,
    opts?: { systemPromptAppend?: string; files?: FileAttachment[] },
  ) => void
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Attachment state
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

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

  // ── Attachment helpers ──────────────────────────────────────────────

  const addFiles = useCallback((files: File[]) => {
    const items: AttachmentItem[] = files.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name,
      type: f.type || 'application/octet-stream',
      size: f.size,
      url: URL.createObjectURL(f),
    }))
    setAttachments((prev) => [...prev, ...items])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.id === id)
      if (found) URL.revokeObjectURL(found.url)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) URL.revokeObjectURL(a.url)
      return []
    })
  }, [])

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      for (const a of attachments) URL.revokeObjectURL(a.url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup only
  }, [])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFiles(Array.from(e.target.files))
      e.target.value = '' // reset to allow re-selecting same files
    },
    [addFiles],
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length > 0) {
        e.preventDefault()
        addFiles(files)
      }
    },
    [addFiles],
  )

  // Drag events on the input card
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      dragCounter.current = 0
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) addFiles(files)
    },
    [addFiles],
  )

  // ── Send ────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const trimmed = value.trim()
    const hasFiles = attachments.length > 0
    if ((!trimmed && !hasFiles) || disabled) return

    // Convert attachments to FileAttachment[]
    let files: FileAttachment[] | undefined
    if (hasFiles) {
      files = await Promise.all(
        attachments.map(async (a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          size: a.size,
          data: await blobUrlToBase64(a.url),
        })),
      )
    }

    const opts: { systemPromptAppend?: string; files?: FileAttachment[] } = {}
    if (selectedSkill?.content) opts.systemPromptAppend = selectedSkill.content
    if (files) opts.files = files

    onSend(
      trimmed || 'Please review the attached file(s).',
      Object.keys(opts).length > 0 ? opts : undefined,
    )
    setValue('')
    setSelectedSkill(null)
    clearAttachments()
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore Enter during IME composition (e.g. Chinese input choosing a candidate)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    // Let slash popover handle navigation keys
    if (slashVisible && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
      return // SlashCommandPopover handles these via window listener
    }
    // Backspace removes last attachment when textarea is empty
    if (e.key === 'Backspace' && value === '' && attachments.length > 0) {
      e.preventDefault()
      removeAttachment(attachments[attachments.length - 1].id)
      return
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

  const canSend = !disabled && (value.trim().length > 0 || attachments.length > 0)

  // Find current model label for display
  const currentLabel = findModelLabel(groups, currentProviderId, currentModel)

  return (
    <div className="bg-white/80 dark:bg-zinc-950/80 backdrop-blur-lg px-4 pb-4 pt-2">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      <div
        className={cn(
          'relative flex flex-col',
          'rounded-2xl border shadow-sm',
          'bg-white dark:bg-zinc-900',
          'transition-shadow',
          isDragging
            ? 'border-blue-400 dark:border-blue-500 shadow-blue-100/50 dark:shadow-blue-900/30 shadow-md ring-2 ring-blue-400/30'
            : focused
              ? 'border-blue-400 dark:border-blue-500 shadow-blue-100/50 dark:shadow-blue-900/30 shadow-md'
              : 'border-zinc-200 dark:border-zinc-700',
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
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

        {/* Attachment capsules */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-1">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 pl-1.5 pr-1 py-0.5 text-xs text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
              >
                {isImage(a.type) ? (
                  <img src={a.url} alt={a.name} className="h-5 w-5 rounded object-cover" />
                ) : (
                  <FileIcon size={12} className="text-zinc-500" />
                )}
                <span className="max-w-[100px] truncate text-[11px]">{a.name}</span>
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-blue-500/10 backdrop-blur-sm">
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">拖放文件到这里</p>
          </div>
        )}

        {/* Textarea area */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
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
          {/* Left: attach + model selector + hints */}
          <div className="flex items-center gap-3">
            {/* Attach file button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center h-7 w-7 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
              title="添加附件"
            >
              <Plus size={16} />
            </button>

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
                          modelsMatch(m.value, currentModel) &&
                          group.provider_id === currentProviderId
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

/**
 * Check if two model identifiers refer to the same model.
 * Handles shorthand ("sonnet") vs full SDK ID ("claude-sonnet-4-20250514")
 * by checking if the shorter string is a substring of the longer one.
 */
function modelsMatch(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  return la.includes(lb) || lb.includes(la)
}

/** Find the display label for the current model in the groups. */
function findModelLabel(groups: ProviderModelGroup[], providerId: string, modelId: string): string {
  // Try exact match (provider + model)
  const group = groups.find((g) => g.provider_id === providerId)
  if (group) {
    const exact = group.models.find((m) => m.value === modelId)
    if (exact) return exact.label
    // Fuzzy match: shorthand vs full model ID
    const fuzzy = group.models.find((m) => modelsMatch(m.value, modelId))
    if (fuzzy) return fuzzy.label
  }
  // Fallback: search all groups
  for (const g of groups) {
    const exact = g.models.find((m) => m.value === modelId)
    if (exact) return exact.label
  }
  for (const g of groups) {
    const fuzzy = g.models.find((m) => modelsMatch(m.value, modelId))
    if (fuzzy) return fuzzy.label
  }
  return modelId || 'Select model'
}
