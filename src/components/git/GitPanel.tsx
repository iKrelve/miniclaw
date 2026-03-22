/**
 * GitPanel — Git status, history, and branch management.
 */

import { useEffect, useState, useCallback } from 'react'
import { useSidecar } from '../../hooks/useSidecar'
import { useAppStore } from '../../stores'
import { GitBranch, Clock, FileText, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

interface GitFile {
  status: string
  path: string
}
interface GitCommit {
  hash: string
  author: string
  date: string
  message: string
}

export function GitPanel() {
  const { baseUrl } = useSidecar()
  const { activeSessionId, sessions } = useAppStore()
  const cwd = sessions.find((s) => s.id === activeSessionId)?.working_directory || '~'

  const [branch, setBranch] = useState('')
  const [files, setFiles] = useState<GitFile[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [statusOpen, setStatusOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)

  const refresh = useCallback(async () => {
    if (!baseUrl) return
    setLoading(true)
    try {
      const [statusRes, logRes, branchRes] = await Promise.all([
        fetch(`${baseUrl}/git/status?cwd=${encodeURIComponent(cwd)}`),
        fetch(`${baseUrl}/git/log?cwd=${encodeURIComponent(cwd)}&limit=15`),
        fetch(`${baseUrl}/git/branches?cwd=${encodeURIComponent(cwd)}`),
      ])
      const status = await statusRes.json()
      const log = await logRes.json()
      const br = await branchRes.json()
      setBranch(status.branch || '')
      setFiles(status.files || [])
      setCommits(log.commits || [])
      setBranches(br.branches || [])
    } catch {
      // not a git repo
    } finally {
      setLoading(false)
    }
  }, [baseUrl, cwd])

  useEffect(() => {
    refresh()
  }, [refresh])

  const statusColor = (s: string) => {
    if (s.includes('M')) return 'text-amber-500'
    if (s.includes('A') || s.includes('?')) return 'text-green-500'
    if (s.includes('D')) return 'text-red-500'
    return 'text-zinc-500'
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-blue-500" />
          <span className="font-semibold text-sm">{branch || 'Not a git repo'}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Changed Files */}
      <section>
        <button
          onClick={() => setStatusOpen(!statusOpen)}
          className="flex items-center gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
        >
          {statusOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FileText size={14} />
          Changed Files ({files.length})
        </button>
        {statusOpen && (
          <div className="space-y-1 pl-5">
            {files.length === 0 && <p className="text-xs text-zinc-500">Working tree clean</p>}
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                <span className={cn('w-5 text-center font-bold', statusColor(f.status))}>
                  {f.status}
                </span>
                <span className="truncate text-zinc-700 dark:text-zinc-300">{f.path}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Commit History */}
      <section>
        <button
          onClick={() => setHistoryOpen(!historyOpen)}
          className="flex items-center gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
        >
          {historyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Clock size={14} />
          History
        </button>
        {historyOpen && (
          <div className="space-y-2 pl-5">
            {commits.map((c) => (
              <div key={c.hash} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-blue-500">{c.hash.slice(0, 7)}</span>
                  <span className="text-zinc-500">{new Date(c.date).toLocaleDateString()}</span>
                </div>
                <p className="text-zinc-700 dark:text-zinc-300 truncate">{c.message}</p>
                <p className="text-zinc-400 text-[10px]">{c.author}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Branches */}
      {branches.length > 0 && (
        <section>
          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1">
            <GitBranch size={14} /> Branches
          </div>
          <div className="flex flex-wrap gap-1 pl-5">
            {branches.map((b) => (
              <span
                key={b}
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  b === branch
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
                )}
              >
                {b}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
