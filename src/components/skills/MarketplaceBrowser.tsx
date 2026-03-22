/**
 * MarketplaceBrowser — Left/right split: search results list + skill detail panel.
 * Fetches from /marketplace/search with debounced input.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Loader2, Store } from 'lucide-react'
import { useSidecar } from '../../hooks/useSidecar'
import { MarketplaceSkillCard } from './MarketplaceSkillCard'
import { MarketplaceSkillDetail } from './MarketplaceSkillDetail'
import type { MarketplaceSkill } from '../../../shared/types'

interface MarketplaceBrowserProps {
  onInstalled: () => void
}

export function MarketplaceBrowser({ onInstalled }: MarketplaceBrowserProps) {
  const { baseUrl } = useSidecar()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<MarketplaceSkill[]>([])
  const [selected, setSelected] = useState<MarketplaceSkill | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  const doSearch = useCallback(
    async (query: string) => {
      if (!baseUrl) return
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (query) params.set('q', query)
        params.set('limit', '20')
        const res = await fetch(`${baseUrl}/marketplace/search?${params}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        const data = await res.json()
        setResults(data.skills || [])
      } catch (err) {
        setError((err as Error).message)
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [baseUrl],
  )

  // Initial load
  useEffect(() => {
    doSearch('')
  }, [doSearch])

  // Debounced search on input change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(search), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, doSearch])

  const handleInstallComplete = useCallback(() => {
    doSearch(search)
    onInstalled()
  }, [search, doSearch, onInstalled])

  return (
    <div className="flex flex-1 min-h-0 gap-0">
      {/* Left: search + list */}
      <div className="w-72 border-r border-zinc-200 dark:border-zinc-800 flex flex-col shrink-0">
        {/* Search bar */}
        <div className="p-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索技能市场..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-1">
            {loading && results.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-zinc-400" />
              </div>
            )}
            {error && (
              <div className="flex flex-col items-center gap-2 py-8 px-3 text-zinc-400">
                <p className="text-xs text-center text-red-500">加载市场失败</p>
                <p className="text-[10px] text-center">{error}</p>
              </div>
            )}
            {!loading && !error && results.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-zinc-400">
                <Store size={32} className="opacity-30" />
                <p className="text-xs">未找到匹配的技能</p>
              </div>
            )}
            {results.map((skill) => (
              <MarketplaceSkillCard
                key={skill.id}
                skill={skill}
                selected={selected?.id === skill.id}
                onSelect={() => setSelected(skill)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <MarketplaceSkillDetail
            key={selected.id}
            skill={selected}
            onInstallComplete={handleInstallComplete}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-3">
            <Store size={48} className="opacity-20" />
            <div className="text-center">
              <p className="text-sm font-medium">浏览技能市场</p>
              <p className="text-xs mt-1">搜索并安装社区技能到你的环境</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
