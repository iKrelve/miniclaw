/**
 * SkillsPanel — Skills marketplace for browsing and viewing agent skills.
 */

import { useEffect, useState, useCallback } from 'react'
import { useSidecar } from '../../hooks/useSidecar'
import { Sparkles, Search, Eye } from 'lucide-react'
import { cn } from '../../lib/utils'
import { MarkdownRenderer } from '../chat/MarkdownRenderer'

interface Skill {
  name: string
  description: string
  source: string
  path: string
  content?: string
}

export function SkillsPanel() {
  const { baseUrl } = useSidecar()
  const [skills, setSkills] = useState<Skill[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Skill | null>(null)
  const [loading, setLoading] = useState(false)

  const loadSkills = useCallback(async () => {
    if (!baseUrl) return
    setLoading(true)
    try {
      const res = await fetch(`${baseUrl}/skills`)
      const data = await res.json()
      setSkills(data.skills || [])
    } catch {
      // error
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const handleView = useCallback(
    async (skill: Skill) => {
      if (!baseUrl) return
      try {
        const res = await fetch(`${baseUrl}/skills/${encodeURIComponent(skill.name)}`)
        const data = await res.json()
        setSelected({ ...skill, content: data.content })
      } catch {
        // error
      }
    },
    [baseUrl],
  )

  const filtered = skills.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="flex-1 flex min-h-0">
      {/* Skill list */}
      <div className="w-80 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={18} className="text-amber-500" />
            <h2 className="font-bold">技能</h2>
            <span className="text-xs text-zinc-500 ml-auto">{skills.length}</span>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索技能..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center py-8 text-zinc-400 text-sm">
              {loading ? '加载中...' : '未找到技能'}
            </div>
          )}
          {filtered.map((skill) => (
            <button
              key={skill.name}
              onClick={() => handleView(skill)}
              className={cn(
                'w-full text-left px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 transition-colors',
                selected?.name === skill.name
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
              )}
            >
              <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {skill.name}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{skill.description}</div>
              <span className="text-[10px] text-zinc-400 mt-1 inline-block bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                {skill.source}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Skill content */}
      <div className="flex-1 overflow-auto p-6">
        {selected?.content ? (
          <div>
            <h2 className="text-lg font-bold mb-1">{selected.name}</h2>
            <p className="text-xs text-zinc-500 mb-4">{selected.path}</p>
            <MarkdownRenderer content={selected.content} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-400">
            <div className="text-center">
              <Eye size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">选择一个技能查看详情</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
