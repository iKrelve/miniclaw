/**
 * McpPanel — MCP server configuration and status management.
 */

import { useEffect, useState, useCallback } from 'react'
import { useSidecar } from '../../hooks/useSidecar'
import { Button } from '../ui/button'
import { Puzzle, RefreshCw, Circle } from 'lucide-react'
import { cn } from '../../lib/utils'

interface McpServer {
  name: string
  config: {
    type?: string
    command?: string
    url?: string
    args?: string[]
  }
}

interface McpStatus {
  name: string
  status: string
}

export function McpPanel() {
  const { baseUrl } = useSidecar()
  const [servers, setServers] = useState<McpServer[]>([])
  const [statuses, setStatuses] = useState<McpStatus[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!baseUrl) return
    setLoading(true)
    try {
      const [serversRes, statusRes] = await Promise.all([
        fetch(`${baseUrl}/mcp`),
        fetch(`${baseUrl}/mcp/status`),
      ])
      const serversData = await serversRes.json()
      const statusData = await statusRes.json()
      setServers(serversData.servers || [])
      setStatuses(statusData.servers || [])
    } catch {
      // error
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => {
    refresh()
  }, [refresh])

  const getStatus = (name: string) => statuses.find((s) => s.name === name)?.status || 'unknown'

  const statusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'text-green-500'
      case 'configured':
        return 'text-blue-500'
      case 'error':
        return 'text-red-500'
      default:
        return 'text-zinc-400'
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Puzzle size={20} className="text-blue-500" />
          <h1 className="text-xl font-bold">MCP 服务器</h1>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      <p className="text-sm text-zinc-500">
        MCP 服务器配置来源：
        <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">~/.claude.json</code>、
        <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
          ~/.claude/settings.json
        </code>
        、 项目 <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">.mcp.json</code>
      </p>

      {servers.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">
          <Puzzle size={48} className="mx-auto mb-3 opacity-30" />
          <p>未发现 MCP 服务器配置</p>
          <p className="text-xs mt-1">在上述配置文件中添加 mcpServers 字段</p>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => {
            const status = getStatus(server.name)
            return (
              <div
                key={server.name}
                className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Circle size={8} className={cn('fill-current', statusColor(status))} />
                    <span className="font-medium text-sm">{server.name}</span>
                  </div>
                  <span className="text-xs text-zinc-500 capitalize">{status}</span>
                </div>
                <div className="mt-2 text-xs text-zinc-500 font-mono space-y-0.5">
                  <div>Type: {server.config.type || 'stdio'}</div>
                  {server.config.command && <div>Command: {server.config.command}</div>}
                  {server.config.url && <div>URL: {server.config.url}</div>}
                  {server.config.args && server.config.args.length > 0 && (
                    <div>Args: {server.config.args.join(' ')}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
