/**
 * ChatPermissionSelector — Session-level permission profile toggle.
 *
 * Dropdown with two options: "默认权限" (default) and "完全访问" (full_access).
 * Switching to full_access shows a confirmation dialog warning about auto-approving
 * all actions. Persists changes to the sidecar via PUT /sessions/:id.
 */

import { useState, useRef, useEffect } from 'react'
import { Lock, LockOpen, ChevronDown, AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { useSidecar } from '../../hooks/useSidecar'

type PermissionProfile = 'default' | 'full_access'

interface ChatPermissionSelectorProps {
  sessionId?: string
  permissionProfile: PermissionProfile
  onPermissionChange: (profile: PermissionProfile) => void
}

export function ChatPermissionSelector({
  sessionId,
  permissionProfile,
  onPermissionChange,
}: ChatPermissionSelectorProps) {
  const { baseUrl } = useSidecar()
  const [open, setOpen] = useState(false)
  const [showWarning, setShowWarning] = useState(false)
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

  const handleSelect = (profile: PermissionProfile) => {
    setOpen(false)
    if (profile === 'full_access' && permissionProfile !== 'full_access') {
      setShowWarning(true)
      return
    }
    applyChange(profile)
  }

  const applyChange = async (profile: PermissionProfile) => {
    // No session yet — local-only update
    if (!sessionId || !baseUrl) {
      onPermissionChange(profile)
      return
    }
    try {
      const res = await fetch(`${baseUrl}/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_profile: profile }),
      })
      if (!res.ok) {
        console.warn(`[ChatPermissionSelector] PUT failed: ${res.status}`)
        return
      }
      onPermissionChange(profile)
    } catch (err) {
      console.warn('[ChatPermissionSelector] PUT error:', err)
    }
  }

  const full = permissionProfile === 'full_access'

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-colors font-medium',
            full
              ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
          )}
        >
          {full ? <LockOpen size={12} /> : <Lock size={12} />}
          <span>{full ? '完全访问' : '默认权限'}</span>
          <ChevronDown
            size={10}
            className={cn('transition-transform opacity-60', open && 'rotate-180')}
          />
        </button>

        {open && (
          <div className="absolute left-0 bottom-full mb-1 z-50 w-40 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg overflow-hidden">
            <button
              onClick={() => handleSelect('default')}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors',
                !full && 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
              )}
            >
              <Lock size={14} />
              <span>默认权限</span>
              {!full && <span className="ml-auto text-blue-500 text-xs">✓</span>}
            </button>
            <button
              onClick={() => handleSelect('full_access')}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors',
                full && 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
              )}
            >
              <LockOpen size={14} className="text-red-500" />
              <span>完全访问</span>
              {full && <span className="ml-auto text-red-500 text-xs">✓</span>}
            </button>
          </div>
        )}
      </div>

      {/* Warning dialog when switching to full_access */}
      <Dialog open={showWarning} onOpenChange={setShowWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              开启完全访问
            </DialogTitle>
            <DialogDescription>
              完全访问模式将自动批准此对话的所有权限请求，包括文件写入、命令执行等潜在危险操作。确定要开启吗？
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setShowWarning(false)}>
              取消
            </Button>
            <Button
              size="sm"
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={() => {
                setShowWarning(false)
                applyChange('full_access')
              }}
            >
              开启完全访问
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
