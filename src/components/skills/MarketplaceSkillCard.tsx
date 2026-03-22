/**
 * MarketplaceSkillCard — A single skill item in the marketplace search results.
 * Shows name, source repo, install count, and installed badge.
 */

import { Sparkles, Download, CheckCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { MarketplaceSkill } from '../../../shared/types'

interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill
  selected: boolean
  onSelect: () => void
}

export function MarketplaceSkillCard({ skill, selected, onSelect }: MarketplaceSkillCardProps) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors',
        selected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
      )}
      onClick={onSelect}
    >
      <Sparkles size={16} className="shrink-0 text-amber-500" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{skill.name}</span>
          {skill.isInstalled && (
            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 font-medium shrink-0">
              <CheckCircle size={10} />
              已安装
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
          <span className="truncate">{skill.source}</span>
          {skill.installs > 0 && (
            <span className="flex items-center gap-0.5 shrink-0">
              <Download size={12} />
              {skill.installs.toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
