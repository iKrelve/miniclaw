/**
 * MarketplaceSkillDetail — Right panel showing SKILL.md content,
 * install/uninstall button, and GitHub link for a marketplace skill.
 */

import { useState, useEffect } from 'react'
import { Download, Trash2, ExternalLink, Loader2, CheckCircle, Sparkles } from 'lucide-react'
import { Button } from '../ui/button'
import { MessageResponse } from '../ai-elements/message'
import { InstallProgressDialog } from './InstallProgressDialog'
import { useSidecar } from '../../hooks/useSidecar'
import type { MarketplaceSkill } from '../../../shared/types'

interface MarketplaceSkillDetailProps {
  skill: MarketplaceSkill
  onInstallComplete: () => void
}

export function MarketplaceSkillDetail({ skill, onInstallComplete }: MarketplaceSkillDetailProps) {
  const { baseUrl } = useSidecar()
  const [showProgress, setShowProgress] = useState(false)
  const [progressAction, setProgressAction] = useState<'install' | 'uninstall'>('install')
  const [readme, setReadme] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setReadme(null)
    setLoading(true)

    const load = async () => {
      if (!baseUrl) return
      try {
        const params = new URLSearchParams({ source: skill.source, skillId: skill.skillId })
        const res = await fetch(`${baseUrl}/marketplace/readme?${params}`)
        if (!cancelled && res.ok) {
          const data = await res.json()
          setReadme(data.content || null)
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [baseUrl, skill.source, skill.skillId])

  const handleInstall = () => {
    setProgressAction('install')
    setShowProgress(true)
  }

  const handleUninstall = () => {
    setProgressAction('uninstall')
    setShowProgress(true)
  }

  const githubUrl = skill.source.includes('/') ? `https://github.com/${skill.source}` : null

  // Strip YAML front matter for display
  const content = readme ? readme.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim() : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 shrink-0">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-900/20 shrink-0">
            <Sparkles size={20} className="text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold truncate">{skill.name}</h3>
              {skill.isInstalled && (
                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 font-medium shrink-0">
                  <CheckCircle size={10} />
                  已安装
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-zinc-500 truncate">{skill.source}</span>
              {githubUrl && (
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors shrink-0"
                >
                  <ExternalLink size={14} />
                </a>
              )}
              {skill.installs > 0 && (
                <span className="flex items-center gap-0.5 text-xs text-zinc-500 shrink-0">
                  <Download size={12} />
                  {skill.installs.toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0">
            {skill.isInstalled ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-red-500 hover:text-red-600 border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700"
                onClick={handleUninstall}
              >
                <Trash2 size={14} />
                卸载
              </Button>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={handleInstall}>
                <Download size={14} />
                安装
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Body — SKILL.md content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-zinc-400" />
          </div>
        ) : content ? (
          <MessageResponse>{content}</MessageResponse>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-400 gap-2">
            <p className="text-sm">暂无文档</p>
          </div>
        )}
      </div>

      <InstallProgressDialog
        open={showProgress}
        onClose={() => setShowProgress(false)}
        action={progressAction}
        source={skill.source}
        skillName={skill.name}
        onComplete={onInstallComplete}
      />
    </div>
  )
}
