/**
 * BrowserModeSelector — Toggle external Chrome browser for AI agent use.
 *
 * Three modes: off (default), headed (visible Chrome window), headless (background).
 * Calls sidecar API to start/stop Chrome. When Chrome is running, the miniclaw-browser
 * skill is available to Claude via the miniclaw-desk CLI.
 *
 * Shows a status dot: green = Chrome + agent-browser ready, amber = starting,
 * no dot = off.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Globe, ChevronDown, Monitor, MonitorOff, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useSidecar } from '../../hooks/useSidecar'

export type BrowserMode = 'off' | 'headed' | 'headless'

interface BrowserModeSelectorProps {
  mode: BrowserMode
  onModeChange: (mode: BrowserMode) => void
}

const LABELS: Record<BrowserMode, string> = {
  off: '关闭',
  headed: '前台模式',
  headless: '后台模式',
}

const ICONS: Record<BrowserMode, typeof Globe> = {
  off: MonitorOff,
  headed: Monitor,
  headless: Globe,
}

export function BrowserModeSelector({ mode, onModeChange }: BrowserModeSelectorProps) {
  const { baseUrl } = useSidecar()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Status polling
  const [toolReady, setToolReady] = useState(false)

  useEffect(() => {
    if (mode === 'off' || !baseUrl) {
      setToolReady(false)
      return
    }
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`${baseUrl}/browser/status`)
        const data = await res.json()
        if (!cancelled) setToolReady(data.running === true && data.toolReady === true)
      } catch {
        if (!cancelled) setToolReady(false)
      }
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [mode, baseUrl])

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
  const Icon = ICONS[mode]

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
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
        <span>{loading ? '启动中...' : LABELS[mode]}</span>
        {/* Status dot */}
        {active && !loading && (
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              toolReady ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse',
            )}
          />
        )}
        <ChevronDown
          size={10}
          className={cn('transition-transform opacity-60', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-1 z-50 w-36 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg overflow-hidden">
          {(['off', 'headed', 'headless'] as BrowserMode[]).map((m) => {
            const MIcon = ICONS[m]
            const selected = mode === m
            const isActive = m !== 'off'
            return (
              <button
                key={m}
                onClick={() => handleSelect(m)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors',
                  selected &&
                    isActive &&
                    'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
                  selected &&
                    !isActive &&
                    'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
                )}
              >
                <MIcon size={14} className={isActive ? 'text-emerald-500' : undefined} />
                <span>{LABELS[m]}</span>
                {selected && (
                  <span
                    className={cn(
                      'ml-auto text-xs',
                      isActive ? 'text-emerald-500' : 'text-blue-500',
                    )}
                  >
                    ✓
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
