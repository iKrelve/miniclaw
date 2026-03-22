/**
 * SlashCommandPopover — Shows available slash commands when user types "/".
 */

import { useEffect, useState } from 'react'
import { useSidecar } from '../../hooks/useSidecar'
import { cn } from '../../lib/utils'
import { Sparkles, Terminal, Zap } from 'lucide-react'

interface SlashCommand {
  name: string
  description: string
  source: string
}

interface SlashCommandPopoverProps {
  query: string // text after "/"
  onSelect: (command: string) => void
  onClose: () => void
  visible: boolean
}

export function SlashCommandPopover({
  query,
  onSelect,
  onClose,
  visible,
}: SlashCommandPopoverProps) {
  const { baseUrl } = useSidecar()
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [activeIndex, setActiveIndex] = useState(0)

  // Load commands once
  useEffect(() => {
    if (!baseUrl || !visible) return
    fetch(`${baseUrl}/skills`)
      .then((res) => res.json())
      .then((data) => {
        const skills = (data.skills || []) as Array<{
          name: string
          description: string
          source: string
        }>
        setCommands(
          skills.map((s) => ({ name: s.name, description: s.description, source: s.source })),
        )
      })
      .catch(() => {})
  }, [baseUrl, visible])

  const filtered = commands.filter(
    (c) => !query || c.name.toLowerCase().includes(query.toLowerCase()),
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && filtered[activeIndex]) {
        e.preventDefault()
        onSelect(filtered[activeIndex].name)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, filtered, activeIndex, onSelect, onClose])

  if (!visible || filtered.length === 0) return null

  const iconFor = (source: string) => {
    if (source === 'claude') return <Terminal size={14} className="text-purple-500" />
    if (source === 'miniclaw') return <Sparkles size={14} className="text-amber-500" />
    return <Zap size={14} className="text-blue-500" />
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 mx-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-lg max-h-64 overflow-y-auto z-50">
      <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-100 dark:border-zinc-800">
        技能命令
      </div>
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          onClick={() => onSelect(cmd.name)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
            i === activeIndex
              ? 'bg-blue-50 dark:bg-blue-900/20'
              : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
          )}
        >
          {iconFor(cmd.source)}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">/{cmd.name}</span>
          <span className="text-xs text-zinc-500 truncate ml-auto">{cmd.description}</span>
        </button>
      ))}
    </div>
  )
}
