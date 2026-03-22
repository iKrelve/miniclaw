/**
 * SkillsPanel — Full-featured Skills management panel matching CodePilot.
 *
 * Features:
 * - Tab view: Local (global + project slash commands) / Installed (agent skills)
 * - Search and filter
 * - Create new slash command
 * - Edit existing skill content
 * - Delete slash commands
 * - Kind badge (slash_command / agent_skill)
 * - Source badge (global / project / installed)
 */

import { useEffect, useState, useCallback } from 'react'
import { useSidecar } from '../../hooks/useSidecar'
import { Sparkles, Search, Plus, Save, Trash2, FileText, Package, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { MessageResponse } from '../ai-elements/message'
import type { SkillFile, SkillKind } from '../../../shared/types'

type ViewTab = 'local' | 'installed'

export function SkillsPanel() {
  const { baseUrl } = useSidecar()
  const [skills, setSkills] = useState<SkillFile[]>([])
  const [selected, setSelected] = useState<SkillFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<ViewTab>('local')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createContent, setCreateContent] = useState('')
  const [createScope, setCreateScope] = useState<'global' | 'project'>('global')

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
    async (skill: SkillFile) => {
      if (!baseUrl) return
      try {
        const params = new URLSearchParams()
        if (skill.installedSource) params.set('source', skill.installedSource)
        const qs = params.toString()
        const res = await fetch(
          `${baseUrl}/skills/${encodeURIComponent(skill.name)}${qs ? `?${qs}` : ''}`,
        )
        const data = await res.json()
        setSelected({ ...skill, content: data.content })
        setEditing(false)
      } catch {
        // error
      }
    },
    [baseUrl],
  )

  const handleSave = useCallback(async () => {
    if (!baseUrl || !selected) return
    try {
      const res = await fetch(`${baseUrl}/skills/${encodeURIComponent(selected.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: editContent,
          source: selected.installedSource,
        }),
      })
      if (res.ok) {
        setSelected({ ...selected, content: editContent })
        setEditing(false)
        loadSkills()
      }
    } catch {
      // error
    }
  }, [baseUrl, selected, editContent, loadSkills])

  const handleDelete = useCallback(
    async (skill: SkillFile) => {
      if (!baseUrl) return
      if (!confirm(`确定要删除技能 "${skill.name}" 吗？`)) return
      try {
        const res = await fetch(`${baseUrl}/skills/${encodeURIComponent(skill.name)}`, {
          method: 'DELETE',
        })
        if (res.ok) {
          if (selected?.name === skill.name) setSelected(null)
          loadSkills()
        }
      } catch {
        // error
      }
    },
    [baseUrl, selected, loadSkills],
  )

  const handleCreate = useCallback(async () => {
    if (!baseUrl || !createName.trim()) return
    try {
      const res = await fetch(`${baseUrl}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          content: createContent,
          scope: createScope,
        }),
      })
      if (res.ok) {
        setShowCreate(false)
        setCreateName('')
        setCreateContent('')
        loadSkills()
      }
    } catch {
      // error
    }
  }, [baseUrl, createName, createContent, createScope, loadSkills])

  const localSkills = skills.filter((s) => s.source === 'global' || s.source === 'project')
  const installedSkills = skills.filter((s) => s.source === 'installed')

  const currentSkills = tab === 'local' ? localSkills : installedSkills

  const filtered = currentSkills.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()),
  )

  const kindBadge = (kind: SkillKind) => (
    <span
      className={cn(
        'text-[10px] px-1.5 py-0.5 rounded font-medium',
        kind === 'agent_skill'
          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      )}
    >
      {kind === 'agent_skill' ? 'Agent Skill' : 'Slash Command'}
    </span>
  )

  const sourceBadge = (source: string) => (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
      {source}
    </span>
  )

  return (
    <div className="flex-1 flex min-h-0">
      {/* Left panel: tabs + list */}
      <div className="w-80 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={18} className="text-amber-500" />
            <h2 className="font-bold">技能</h2>
            <span className="text-xs text-zinc-500 ml-auto">{skills.length}</span>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => setTab('local')}
              className={cn(
                'flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors',
                tab === 'local'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800',
              )}
            >
              <FileText size={12} className="inline mr-1" />
              本地 ({localSkills.length})
            </button>
            <button
              onClick={() => setTab('installed')}
              className={cn(
                'flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors',
                tab === 'installed'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800',
              )}
            >
              <Package size={12} className="inline mr-1" />
              已安装 ({installedSkills.length})
            </button>
          </div>

          {/* Search */}
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

          {/* Create button (only for local tab) */}
          {tab === 'local' && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-3"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={14} />
              新建 Slash Command
            </Button>
          )}
        </div>

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center py-8 text-zinc-400 text-sm">
              {loading ? '加载中...' : '未找到技能'}
            </div>
          )}
          {filtered.map((skill) => (
            <div
              key={`${skill.source}-${skill.name}`}
              className={cn(
                'group relative w-full text-left px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 transition-colors cursor-pointer',
                selected?.name === skill.name && selected?.source === skill.source
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
              )}
              onClick={() => handleView(skill)}
            >
              <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                /{skill.name}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{skill.description}</div>
              <div className="flex items-center gap-1.5 mt-1.5">
                {kindBadge(skill.kind)}
                {sourceBadge(skill.source)}
                {skill.installedSource && sourceBadge(skill.installedSource)}
              </div>
              {/* Delete button for slash commands */}
              {skill.kind === 'slash_command' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(skill)
                  }}
                  className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right panel: content viewer / editor */}
      <div className="flex-1 overflow-auto p-6">
        {selected?.content !== undefined ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold">/{selected.name}</h2>
                <p className="text-xs text-zinc-500 mt-0.5">{selected.filePath}</p>
              </div>
              <div className="flex items-center gap-2">
                {editing ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                      取消
                    </Button>
                    <Button size="sm" onClick={handleSave}>
                      <Save size={14} />
                      保存
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditContent(selected.content)
                      setEditing(true)
                    }}
                  >
                    编辑
                  </Button>
                )}
              </div>
            </div>

            {editing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-[calc(100vh-16rem)] p-4 text-sm font-mono rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 resize-none"
              />
            ) : (
              <MessageResponse>{selected.content}</MessageResponse>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-400">
            <div className="text-center">
              <Sparkles size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">选择一个技能查看详情</p>
            </div>
          </div>
        )}
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-[480px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="font-bold">新建 Slash Command</h3>
              <button onClick={() => setShowCreate(false)}>
                <X size={18} className="text-zinc-400" />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto">
              <div>
                <label className="text-sm font-medium block mb-1">名称</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="my-command"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">范围</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCreateScope('global')}
                    className={cn(
                      'flex-1 text-sm py-2 rounded-lg border',
                      createScope === 'global'
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                        : 'border-zinc-200 dark:border-zinc-700',
                    )}
                  >
                    全局
                  </button>
                  <button
                    onClick={() => setCreateScope('project')}
                    className={cn(
                      'flex-1 text-sm py-2 rounded-lg border',
                      createScope === 'project'
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                        : 'border-zinc-200 dark:border-zinc-700',
                    )}
                  >
                    项目
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">内容</label>
                <textarea
                  value={createContent}
                  onChange={(e) => setCreateContent(e.target.value)}
                  placeholder="# 命令名称\n\n在这里编写命令的提示内容..."
                  rows={8}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 resize-none font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-zinc-200 dark:border-zinc-800">
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={!createName.trim()}>
                创建
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
