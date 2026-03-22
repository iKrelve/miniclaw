/**
 * InstallProgressDialog — Shows real-time SSE install/uninstall progress.
 * Displays a log output area and phase indicator (running / success / error).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { useSidecar } from '../../hooks/useSidecar'

interface InstallProgressDialogProps {
  open: boolean
  onClose: () => void
  action: 'install' | 'uninstall'
  source: string
  skillName: string
  onComplete: () => void
}

type Phase = 'running' | 'success' | 'error'

export function InstallProgressDialog({
  open,
  onClose,
  action,
  source,
  skillName,
  onComplete,
}: InstallProgressDialogProps) {
  const { baseUrl } = useSidecar()
  const [phase, setPhase] = useState<Phase>('running')
  const [logs, setLogs] = useState<string[]>([])
  const logsEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    if (!baseUrl) return
    setPhase('running')
    setLogs([])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const endpoint =
        action === 'install' ? `${baseUrl}/marketplace/install` : `${baseUrl}/marketplace/remove`

      const body =
        action === 'install' ? { source, global: true } : { skill: skillName, global: true }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        setPhase('error')
        setLogs((prev) => [...prev, `HTTP ${res.status}: ${res.statusText}`])
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let event = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            event = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6)
            let data: string
            try {
              data = JSON.parse(raw)
            } catch {
              data = raw
            }

            if (event === 'output') {
              setLogs((prev) => [...prev, data])
            } else if (event === 'done') {
              setPhase('success')
            } else if (event === 'error') {
              setPhase('error')
              setLogs((prev) => [...prev, `Error: ${data}`])
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setPhase('error')
        setLogs((prev) => [...prev, (err as Error).message])
      }
    }
  }, [baseUrl, action, source, skillName])

  useEffect(() => {
    if (open) run()
    return () => {
      abortRef.current?.abort()
    }
  }, [open, run])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleClose = () => {
    abortRef.current?.abort()
    if (phase === 'success') onComplete()
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-[520px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 p-4 border-b border-zinc-200 dark:border-zinc-800">
          {phase === 'running' && <Loader2 size={20} className="animate-spin text-blue-500" />}
          {phase === 'success' && <CheckCircle size={20} className="text-green-500" />}
          {phase === 'error' && <XCircle size={20} className="text-red-500" />}
          <h3 className="font-bold">
            {phase === 'running'
              ? action === 'install'
                ? '正在安装...'
                : '正在卸载...'
              : phase === 'success'
                ? action === 'install'
                  ? '安装成功'
                  : '卸载成功'
                : action === 'install'
                  ? '安装失败'
                  : '卸载失败'}
          </h3>
        </div>

        {/* Logs */}
        <div className="flex-1 overflow-y-auto p-4 max-h-64 bg-zinc-50 dark:bg-zinc-950 font-mono text-xs leading-relaxed">
          {logs.length === 0 && phase === 'running' && (
            <span className="text-zinc-400">等待输出...</span>
          )}
          {logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 border-t border-zinc-200 dark:border-zinc-800">
          <Button onClick={handleClose}>{phase === 'running' ? '取消' : '关闭'}</Button>
        </div>
      </div>
    </div>
  )
}
