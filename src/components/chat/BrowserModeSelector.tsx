/**
 * BrowserModeSelector — Toggle external Chrome browser for AI agent use.
 *
 * Three modes: off (default), headed (visible Chrome window), headless (background).
 * Calls sidecar API to start/stop Chrome. When Chrome is running, the browser_action
 * MCP tool is automatically injected into the Claude session.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Globe, ChevronDown, Monitor, MonitorOff } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useSidecar } from '../../hooks/useSidecar'

export type BrowserMode = 'off' | 'headed' | 'headless'

interface BrowserModeSelectorProps {
  mode: BrowserMode
  onModeChange: (mode: BrowserMode) => void
}

const LABELS: Record<BrowserMode, string> = {
  off: '浏览器关',
  headed: '有头浏览器',
  headless: '无头浏览器',
}

export function BrowserModeSelector({ mode, onModeChange }: BrowserModeSelectorProps) {
  const { baseUrl } = useSidecar()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = useCallback(
    async (next: BrowserMode) => {
      setOpen(false)
      if (next === mode || !baseUrl) return
      setLoading(true)

      try {
        if (next === 'off') {
          await fetch(`${baseUrl}/browser/stop`, { method: 'POST' })
        } else {
          await fetch(`${baseUrl}/browser/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headless: next === 'headless' }),
          })
        }
        onModeChange(next)
      } catch (err) {
        console.warn('[BrowserModeSelector] API error:', err)
      } finally {
        setLoading(false)
      }
    },
    [baseUrl, mode, onModeChange],
  )

  const active = mode !== 'off'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className={cn(
          'flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-colors font-medium',
          loading && 'opacity-50 cursor-wait',
          active
            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50'
            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
        )}
      >
        <Globe size={12} />
        <span>{loading ? '启动中...' : LABELS[mode]}</span>
        <ChevronDown
          size={10}
          className={cn('transition-transform opacity-60', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-1 z-50 w-40 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg overflow-hidden">
          <button
            onClick={() => handleSelect('off')}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors',
              mode === 'off' && 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
            )}
          >
            <MonitorOff size={14} />
            <span>关闭</span>
            {mode === 'off' && <span className="ml-auto text-blue-500 text-xs">✓</span>}
          </button>
          <button
            onClick={() => handleSelect('headed')}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors',
              mode === 'headed' &&
                'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
            )}
          >
            <Monitor size={14} className="text-emerald-500" />
            <span>有头模式</span>
            {mode === 'headed' && <span className="ml-auto text-emerald-500 text-xs">✓</span>}
          </button>
          <button
            onClick={() => handleSelect('headless')}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors',
              mode === 'headless' &&
                'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
            )}
          >
            <Globe size={14} className="text-emerald-500" />
            <span>无头模式</span>
            {mode === 'headless' && <span className="ml-auto text-emerald-500 text-xs">✓</span>}
          </button>
        </div>
      )}
    </div>
  )
}
