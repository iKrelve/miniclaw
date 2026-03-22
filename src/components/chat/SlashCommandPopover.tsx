/**
 * SlashCommandPopover — Shows available slash commands when user types "/".
 * Fetches skills from sidecar and provides selection with keyboard navigation.
 *
 * When a skill is selected, its content is passed back so it can be used
 * as systemPromptAppend in the chat request.
 */

import { useEffect, useState } from 'react'
import { useSidecar } from '../../hooks/useSidecar'
import { cn } from '../../lib/utils'
import { Sparkles, Terminal, Package } from 'lucide-react'
import type { SkillFile } from '../../../shared/types'

export interface SelectedSkill {
  name: string
  description: string
  content: string
  kind: string
}

interface SlashCommandPopoverProps {
  query: string
  onSelect: (skill: SelectedSkill) => void
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
  const [commands, setCommands] = useState<SkillFile[]>([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (!baseUrl || !visible) return
    fetch(`${baseUrl}/skills`)
      .then((res) => res.json())
      .then((data) => {
        setCommands(data.skills || [])
      })
      .catch(() => {})
  }, [baseUrl, visible])

  const filtered = commands.filter(
    (c) => !query || c.name.toLowerCase().includes(query.toLowerCase()),
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

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
        handleSelect(filtered[activeIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab' && filtered[activeIndex]) {
        e.preventDefault()
        handleSelect(filtered[activeIndex])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, filtered, activeIndex, onClose])

  const handleSelect = async (skill: SkillFile) => {
    // If content is already available, use it directly
    if (skill.content) {
      onSelect({
        name: skill.name,
        description: skill.description,
        content: skill.content,
        kind: skill.kind,
      })
      return
    }

    // Otherwise fetch the full content
    if (!baseUrl) return
    try {
      const res = await fetch(`${baseUrl}/skills/${encodeURIComponent(skill.name)}`)
      const data = await res.json()
      onSelect({
        name: skill.name,
        description: skill.description,
        content: data.content || '',
        kind: skill.kind,
      })
    } catch {
      onSelect({
        name: skill.name,
        description: skill.description,
        content: '',
        kind: skill.kind,
      })
    }
  }

  if (!visible || filtered.length === 0) return null

  const iconFor = (skill: SkillFile) => {
    if (skill.kind === 'agent_skill')
      return <Package size={14} className="text-purple-500 shrink-0" />
    if (skill.source === 'installed')
      return <Sparkles size={14} className="text-amber-500 shrink-0" />
    return <Terminal size={14} className="text-blue-500 shrink-0" />
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 mx-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-lg max-h-64 overflow-y-auto z-50">
      <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-1.5">
        <Sparkles size={12} />
        技能命令 · {filtered.length} 个可用
      </div>
      {filtered.map((cmd, i) => (
        <button
          key={`${cmd.source}-${cmd.name}`}
          onClick={() => handleSelect(cmd)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
            i === activeIndex
              ? 'bg-blue-50 dark:bg-blue-900/20'
              : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
          )}
        >
          {iconFor(cmd)}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">/{cmd.name}</span>
          <span className="text-xs text-zinc-500 truncate ml-auto max-w-48">{cmd.description}</span>
        </button>
      ))}
    </div>
  )
}
