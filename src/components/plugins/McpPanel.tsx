/**
 * McpPanel — Full-featured MCP server management panel matching CodePilot.
 *
 * Features:
 * - Dual tab: List view + JSON editor
 * - Add new MCP server (stdio / sse / http form)
 * - Edit existing server config
 * - Delete server
 * - Enable/disable toggle
 * - Runtime connection status badge
 * - Config source indicator (global / user / project)
 */

import { useEffect, useState, useCallback } from 'react'
import { useSidecar } from '../../hooks/useSidecar'
import { Button } from '../ui/button'
import {
  Puzzle,
  RefreshCw,
  Circle,
  Plus,
  Trash2,
  Pencil,
  X,
  List,
  Code,
  ToggleLeft,
  ToggleRight,
  Save,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import type { McpServerConfig, McpStatus } from '../../../shared/types'

interface McpServer {
  name: string
  config: McpServerConfig
  source: string
  status: McpStatus
}

type ViewTab = 'list' | 'json'

export function McpPanel() {
  const { baseUrl } = useSidecar()
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<ViewTab>('list')

  // JSON editor state
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [jsonSaving, setJsonSaving] = useState(false)

  // Add/Edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null) // null = add new
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<'stdio' | 'sse' | 'http'>('stdio')
  const [formCommand, setFormCommand] = useState('')
  const [formArgs, setFormArgs] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formEnv, setFormEnv] = useState('')
  const [formHeaders, setFormHeaders] = useState('')
  const [formDescription, setFormDescription] = useState('')

  const refresh = useCallback(async () => {
    if (!baseUrl) return
    setLoading(true)
    try {
      const res = await fetch(`${baseUrl}/mcp`)
      const data = await res.json()
      setServers(data.servers || [])
    } catch {
      // error
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  const loadJsonConfig = useCallback(async () => {
    if (!baseUrl) return
    try {
      const res = await fetch(`${baseUrl}/mcp/config`)
      const data = await res.json()
      setJsonText(JSON.stringify(data.mcpServers || {}, null, 2))
      setJsonError(null)
    } catch {
      setJsonError('无法加载配置')
    }
  }, [baseUrl])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (tab === 'json') loadJsonConfig()
  }, [tab, loadJsonConfig])

  const handleSaveJson = useCallback(async () => {
    if (!baseUrl) return
    try {
      const parsed = JSON.parse(jsonText)
      setJsonSaving(true)
      const res = await fetch(`${baseUrl}/mcp/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpServers: parsed }),
      })
      if (res.ok) {
        setJsonError(null)
        refresh()
      } else {
        setJsonError('保存失败')
      }
    } catch {
      setJsonError('JSON 格式错误')
    } finally {
      setJsonSaving(false)
    }
  }, [baseUrl, jsonText, refresh])

  const handleToggle = useCallback(
    async (name: string, currentEnabled: boolean) => {
      if (!baseUrl) return
      try {
        await fetch(`${baseUrl}/mcp/${encodeURIComponent(name)}/toggle`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !currentEnabled }),
        })
        refresh()
      } catch {
        // error
      }
    },
    [baseUrl, refresh],
  )

  const handleDelete = useCallback(
    async (name: string) => {
      if (!baseUrl) return
      if (!confirm(`确定要删除 MCP 服务器 "${name}" 吗？`)) return
      try {
        await fetch(`${baseUrl}/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' })
        refresh()
      } catch {
        // error
      }
    },
    [baseUrl, refresh],
  )

  const openAddDialog = () => {
    setEditingName(null)
    setFormName('')
    setFormType('stdio')
    setFormCommand('')
    setFormArgs('')
    setFormUrl('')
    setFormEnv('')
    setFormHeaders('')
    setFormDescription('')
    setDialogOpen(true)
  }

  const openEditDialog = (server: McpServer) => {
    setEditingName(server.name)
    setFormName(server.name)
    setFormType((server.config.type as 'stdio' | 'sse' | 'http') || 'stdio')
    setFormCommand(server.config.command || '')
    setFormArgs(server.config.args?.join(', ') || '')
    setFormUrl(server.config.url || '')
    setFormEnv(server.config.env ? JSON.stringify(server.config.env, null, 2) : '')
    setFormHeaders(server.config.headers ? JSON.stringify(server.config.headers, null, 2) : '')
    setFormDescription(server.config.description || '')
    setDialogOpen(true)
  }

  const handleSaveServer = useCallback(async () => {
    if (!baseUrl || !formName.trim()) return

    const config: McpServerConfig = { type: formType }
    if (formType === 'stdio') {
      config.command = formCommand
      if (formArgs.trim()) {
        config.args = formArgs.split(',').map((a) => a.trim())
      }
    } else {
      config.url = formUrl
    }
    if (formEnv.trim()) {
      try {
        config.env = JSON.parse(formEnv)
      } catch {
        // ignore invalid env
      }
    }
    if (formHeaders.trim()) {
      try {
        config.headers = JSON.parse(formHeaders)
      } catch {
        // ignore invalid headers
      }
    }
    if (formDescription.trim()) {
      config.description = formDescription
    }

    try {
      if (editingName) {
        await fetch(`${baseUrl}/mcp/${encodeURIComponent(editingName)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config }),
        })
      } else {
        await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName.trim(), config }),
        })
      }
      setDialogOpen(false)
      refresh()
    } catch {
      // error
    }
  }, [
    baseUrl,
    editingName,
    formName,
    formType,
    formCommand,
    formArgs,
    formUrl,
    formEnv,
    formHeaders,
    formDescription,
    refresh,
  ])

  const statusColor = (status: McpStatus) => {
    switch (status) {
      case 'connected':
        return 'text-green-500'
      case 'configured':
        return 'text-blue-500'
      case 'disabled':
        return 'text-zinc-400'
      case 'error':
      case 'failed':
        return 'text-red-500'
      default:
        return 'text-zinc-400'
    }
  }

  const statusLabel = (status: McpStatus) => {
    switch (status) {
      case 'connected':
        return '已连接'
      case 'configured':
        return '已配置'
      case 'disabled':
        return '已禁用'
      case 'error':
      case 'failed':
        return '错误'
      case 'disconnected':
        return '未连接'
      default:
        return status
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Puzzle size={20} className="text-blue-500" />
          <h1 className="text-xl font-bold">MCP 服务器</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            刷新
          </Button>
          <Button size="sm" onClick={openAddDialog}>
            <Plus size={14} />
            添加
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
        <button
          onClick={() => setTab('list')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 text-sm py-1.5 rounded-md font-medium transition-colors',
            tab === 'list'
              ? 'bg-white dark:bg-zinc-900 shadow-sm text-zinc-800 dark:text-zinc-200'
              : 'text-zinc-500',
          )}
        >
          <List size={14} />
          列表
        </button>
        <button
          onClick={() => setTab('json')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 text-sm py-1.5 rounded-md font-medium transition-colors',
            tab === 'json'
              ? 'bg-white dark:bg-zinc-900 shadow-sm text-zinc-800 dark:text-zinc-200'
              : 'text-zinc-500',
          )}
        >
          <Code size={14} />
          JSON
        </button>
      </div>

      {/* Tab content */}
      {tab === 'list' ? (
        <div>
          <p className="text-sm text-zinc-500 mb-4">
            配置来源：
            <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded mx-0.5">
              ~/.claude.json
            </code>
            <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded mx-0.5">
              ~/.claude/settings.json
            </code>
            <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded mx-0.5">
              .mcp.json
            </code>
          </p>

          {servers.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              <Puzzle size={48} className="mx-auto mb-3 opacity-30" />
              <p>未发现 MCP 服务器配置</p>
              <p className="text-xs mt-1">点击"添加"按钮或在配置文件中添加 mcpServers 字段</p>
            </div>
          ) : (
            <div className="space-y-3">
              {servers.map((server) => {
                const enabled = server.config.enabled !== false
                return (
                  <div
                    key={server.name}
                    className={cn(
                      'p-4 rounded-xl border bg-zinc-50 dark:bg-zinc-900',
                      enabled
                        ? 'border-zinc-200 dark:border-zinc-800'
                        : 'border-zinc-200/50 dark:border-zinc-800/50 opacity-60',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Circle
                          size={8}
                          className={cn('fill-current', statusColor(server.status))}
                        />
                        <span className="font-medium text-sm">{server.name}</span>
                        <span className={cn('text-xs capitalize', statusColor(server.status))}>
                          {statusLabel(server.status)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {/* Source badge */}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                          {server.source}
                        </span>
                        {/* Toggle */}
                        <button
                          onClick={() => handleToggle(server.name, enabled)}
                          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          title={enabled ? '禁用' : '启用'}
                        >
                          {enabled ? (
                            <ToggleRight size={18} className="text-blue-500" />
                          ) : (
                            <ToggleLeft size={18} />
                          )}
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => openEditDialog(server)}
                          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          title="编辑"
                        >
                          <Pencil size={14} />
                        </button>
                        {/* Delete (only user-level) */}
                        {server.source === 'user' && (
                          <button
                            onClick={() => handleDelete(server.name)}
                            className="text-zinc-400 hover:text-red-500"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Config details */}
                    <div className="mt-2 text-xs text-zinc-500 font-mono space-y-0.5">
                      <div>Type: {server.config.type || 'stdio'}</div>
                      {server.config.command && <div>Command: {server.config.command}</div>}
                      {server.config.url && <div>URL: {server.config.url}</div>}
                      {server.config.args && server.config.args.length > 0 && (
                        <div>Args: {server.config.args.join(' ')}</div>
                      )}
                      {server.config.description && (
                        <div className="text-zinc-400">{server.config.description}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* JSON Editor */
        <div className="space-y-3">
          <p className="text-sm text-zinc-500">
            直接编辑 MCP 配置 JSON。保存后写入{' '}
            <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
              ~/.claude/settings.json
            </code>
          </p>
          <textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value)
              setJsonError(null)
            }}
            className="w-full h-80 p-4 text-sm font-mono rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 resize-none"
          />
          {jsonError && <p className="text-sm text-red-500">{jsonError}</p>}
          <div className="flex justify-end">
            <Button onClick={handleSaveJson} disabled={jsonSaving}>
              <Save size={14} />
              保存
            </Button>
          </div>
        </div>
      )}

      {/* Add/Edit Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-[520px] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="font-bold">
                {editingName ? `编辑: ${editingName}` : '添加 MCP 服务器'}
              </h3>
              <button onClick={() => setDialogOpen(false)}>
                <X size={18} className="text-zinc-400" />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto">
              {/* Name */}
              {!editingName && (
                <div>
                  <label className="text-sm font-medium block mb-1">名称</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="my-server"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                  />
                </div>
              )}

              {/* Transport type */}
              <div>
                <label className="text-sm font-medium block mb-1">传输类型</label>
                <div className="flex gap-2">
                  {(['stdio', 'sse', 'http'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setFormType(t)}
                      className={cn(
                        'flex-1 text-sm py-2 rounded-lg border',
                        formType === t
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                          : 'border-zinc-200 dark:border-zinc-700',
                      )}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* stdio fields */}
              {formType === 'stdio' && (
                <>
                  <div>
                    <label className="text-sm font-medium block mb-1">命令</label>
                    <input
                      type="text"
                      value={formCommand}
                      onChange={(e) => setFormCommand(e.target.value)}
                      placeholder="npx"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">参数（逗号分隔）</label>
                    <input
                      type="text"
                      value={formArgs}
                      onChange={(e) => setFormArgs(e.target.value)}
                      placeholder="-y, @modelcontextprotocol/server-filesystem, /tmp"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                    />
                  </div>
                </>
              )}

              {/* sse/http fields */}
              {(formType === 'sse' || formType === 'http') && (
                <div>
                  <label className="text-sm font-medium block mb-1">URL</label>
                  <input
                    type="text"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder="http://localhost:3001/mcp"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                  />
                </div>
              )}

              {/* Environment variables */}
              <div>
                <label className="text-sm font-medium block mb-1">环境变量（JSON）</label>
                <textarea
                  value={formEnv}
                  onChange={(e) => setFormEnv(e.target.value)}
                  placeholder='{"API_KEY": "sk-xxx"}'
                  rows={3}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 resize-none font-mono"
                />
              </div>

              {/* Headers (for sse/http) */}
              {(formType === 'sse' || formType === 'http') && (
                <div>
                  <label className="text-sm font-medium block mb-1">HTTP 请求头（JSON）</label>
                  <textarea
                    value={formHeaders}
                    onChange={(e) => setFormHeaders(e.target.value)}
                    placeholder='{"Authorization": "Bearer xxx"}'
                    rows={2}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 resize-none font-mono"
                  />
                </div>
              )}

              {/* Description */}
              <div>
                <label className="text-sm font-medium block mb-1">描述（可选）</label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="A helpful MCP server"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-zinc-200 dark:border-zinc-800">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleSaveServer} disabled={!formName.trim()}>
                {editingName ? '保存' : '添加'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
