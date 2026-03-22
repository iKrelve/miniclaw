/**
 * ProviderSection — API Provider management (CodePilot-aligned).
 *
 * Two-section layout:
 *   Section 1: "已连接" — Claude Code default + user-added providers
 *   Section 2: "添加 Provider" — Quick Presets list, click to open Dialog
 *
 * Adding a provider opens a Dialog (not an inline form), matching CodePilot's
 * PresetConnectDialog UX.
 */

import { useEffect, useState, useCallback } from 'react'
import { Pencil, Loader2, Server, Zap, Cloud, Globe, Cpu, Wrench } from 'lucide-react'
import { useSidecar } from '../../hooks/useSidecar'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog'
import { SettingsCard } from './SettingsCard'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Provider {
  id: string
  name: string
  type: string
  api_key: string
  base_url: string
  is_active: number
}

interface Preset {
  key: string
  name: string
  description: string
  icon: typeof Server
  type: string
  base_url: string
}

// ─── Preset definitions ──────────────────────────────────────────────────────

const PRESETS: Preset[] = [
  {
    key: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 官方 API',
    icon: Zap,
    type: 'anthropic',
    base_url: 'https://api.anthropic.com',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    description: 'GPT 系列模型',
    icon: Cloud,
    type: 'openai',
    base_url: 'https://api.openai.com',
  },
  {
    key: 'google',
    name: 'Google',
    description: 'Gemini 系列模型',
    icon: Globe,
    type: 'google',
    base_url: 'https://generativelanguage.googleapis.com',
  },
  {
    key: 'bedrock',
    name: 'AWS Bedrock',
    description: 'Amazon Bedrock — 需要 AWS 凭证',
    icon: Server,
    type: 'bedrock',
    base_url: '',
  },
  {
    key: 'vertex',
    name: 'Google Vertex',
    description: 'Google Vertex AI — 需要 GCP 凭证',
    icon: Cloud,
    type: 'vertex',
    base_url: '',
  },
  {
    key: 'custom',
    name: 'Custom Proxy',
    description: '自定义 OpenAI 兼容 API 端点',
    icon: Wrench,
    type: 'custom',
    base_url: '',
  },
]

// ─── Shared input style ──────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors font-mono'

// ─── Provider icon resolver ──────────────────────────────────────────────────

function providerIcon(type: string) {
  switch (type) {
    case 'anthropic':
      return Zap
    case 'openai':
      return Cloud
    case 'google':
      return Globe
    case 'bedrock':
      return Server
    case 'vertex':
      return Cloud
    default:
      return Cpu
  }
}

// ─── Connect Dialog ──────────────────────────────────────────────────────────

function ConnectDialog({
  preset,
  open,
  onOpenChange,
  onSave,
  editProvider,
}: {
  preset: Preset | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: { name: string; type: string; api_key: string; base_url: string }) => Promise<void>
  editProvider?: Provider | null
}) {
  const isEdit = !!editProvider
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when dialog opens
  useEffect(() => {
    if (!open || !preset) return
    setError(null)
    setSaving(false)
    if (isEdit && editProvider) {
      setName(editProvider.name)
      setApiKey(editProvider.api_key || '')
      setBaseUrl(editProvider.base_url || '')
    } else {
      setName(preset.name)
      setApiKey('')
      setBaseUrl(preset.base_url)
    }
  }, [open, preset, isEdit, editProvider])

  if (!preset) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!apiKey.trim() && preset.key !== 'bedrock' && preset.key !== 'vertex') {
      setError('请输入 API Key')
      return
    }

    setSaving(true)
    try {
      await onSave({
        name: name.trim() || preset.name,
        type: preset.type,
        api_key: apiKey.trim(),
        base_url: baseUrl.trim(),
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setSaving(false)
    }
  }

  const Icon = preset.icon

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[28rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <Icon size={18} />
            {isEdit ? '编辑' : '连接'} {preset.name}
          </DialogTitle>
          <DialogDescription>{preset.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Name */}
          {(preset.key === 'custom' || isEdit) && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                名称
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={preset.name}
                className={inputClass}
              />
            </div>
          )}

          {/* Base URL */}
          {(preset.key === 'custom' || preset.base_url === '' || isEdit) && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                className={inputClass}
              />
            </div>
          )}

          {/* API Key */}
          {preset.key !== 'bedrock' && preset.key !== 'vertex' && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className={inputClass}
                autoFocus
              />
            </div>
          )}

          {/* Environment hint for Bedrock / Vertex */}
          {(preset.key === 'bedrock' || preset.key === 'vertex') && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {preset.key === 'bedrock'
                ? '请在 API 代理页配置 AWS 凭证相关环境变量 (AWS_REGION, AWS_ACCESS_KEY_ID 等)'
                : '请在 API 代理页配置 GCP 凭证相关环境变量 (CLOUD_ML_REGION 等)'}
            </p>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? '保存中...' : isEdit ? '更新' : '连接'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Delete Confirmation Dialog ──────────────────────────────────────────────

function DeleteDialog({
  provider,
  open,
  onOpenChange,
  onConfirm,
}: {
  provider: Provider | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>断开 Provider</DialogTitle>
          <DialogDescription>
            确定要断开 <strong>{provider?.name}</strong> 吗？此操作将删除该 Provider 的所有配置。
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
            className="gap-2"
          >
            {deleting && <Loader2 size={14} className="animate-spin" />}
            {deleting ? '断开中...' : '断开'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ProviderSection() {
  const { baseUrl } = useSidecar()
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)

  // Dialog state
  const [connectPreset, setConnectPreset] = useState<Preset | null>(null)
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [editProvider, setEditProvider] = useState<Provider | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null)

  const fetchProviders = useCallback(async () => {
    if (!baseUrl) return
    try {
      const res = await fetch(`${baseUrl}/providers`)
      const data = await res.json()
      setProviders(data.providers || [])
    } catch {
      // error
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const handleConnect = async (data: {
    name: string
    type: string
    api_key: string
    base_url: string
  }) => {
    if (!baseUrl) return
    const res = await fetch(`${baseUrl}/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Failed to add provider')
    if (result.provider) {
      setProviders((prev) => [...prev, result.provider])
    }
  }

  const handleEdit = (provider: Provider) => {
    const preset = PRESETS.find((p) => p.type === provider.type) || PRESETS[PRESETS.length - 1]
    setConnectPreset(preset)
    setEditProvider(provider)
    setConnectDialogOpen(true)
  }

  const handleEditSave = async (data: {
    name: string
    type: string
    api_key: string
    base_url: string
  }) => {
    if (!baseUrl || !editProvider) return
    const res = await fetch(`${baseUrl}/providers/${editProvider.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to update provider')
    }
    // Refresh full list
    await fetchProviders()
  }

  const handleActivate = async (id: string) => {
    if (!baseUrl) return
    await fetch(`${baseUrl}/providers/${id}/activate`, { method: 'POST' })
    await fetchProviders()
  }

  const handleDelete = async () => {
    if (!baseUrl || !deleteTarget) return
    await fetch(`${baseUrl}/providers/${deleteTarget.id}`, { method: 'DELETE' })
    setProviders((prev) => prev.filter((p) => p.id !== deleteTarget.id))
  }

  const handleOpenPresetDialog = (preset: Preset) => {
    setConnectPreset(preset)
    setEditProvider(null)
    setConnectDialogOpen(true)
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-zinc-500">
          <Loader2 size={16} className="animate-spin" />
          <p className="text-sm">加载中...</p>
        </div>
      )}

      {/* ─── Section 1: Connected Providers ─── */}
      {!loading && (
        <SettingsCard title="已连接的 Provider">
          {/* Claude Code SDK default — always shown */}
          <div className="border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div className="flex items-center gap-3 py-2 px-1">
              <div className="shrink-0 w-[22px] flex justify-center">
                <Zap size={16} className="text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Claude Code</span>
                  <span className="text-[10px] px-1.5 py-0 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500">
                    默认
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 ml-[34px] leading-relaxed">
              使用 Claude Code SDK 的内置配置，可在 API 代理页覆盖 Base URL 和 Token
            </p>
          </div>

          {/* Connected provider list */}
          {providers.length > 0 ? (
            providers.map((p) => {
              const Icon = providerIcon(p.type)
              return (
                <div
                  key={p.id}
                  className="py-2.5 px-1 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 w-[22px] flex justify-center">
                      <Icon size={16} className="text-zinc-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{p.name}</span>
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0 rounded border',
                            p.is_active
                              ? 'border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                              : 'border-zinc-200 dark:border-zinc-700 text-zinc-500',
                          )}
                        >
                          {p.is_active ? '当前' : p.api_key ? 'API Key' : '已配置'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!p.is_active && (
                        <Button variant="ghost" size="sm" onClick={() => handleActivate(p.id)}>
                          启用
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleEdit(p)}
                      >
                        <Pencil size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                        onClick={() => setDeleteTarget(p)}
                      >
                        断开
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="text-xs text-zinc-500 py-4 text-center">尚未添加其他 Provider</p>
          )}
        </SettingsCard>
      )}

      {/* ─── Section 2: Add Provider (Quick Presets) ─── */}
      {!loading && (
        <SettingsCard
          title="添加 Provider"
          description="选择一个服务商快速连接，或添加自定义 API 端点"
        >
          {PRESETS.map((preset) => (
            <div
              key={preset.key}
              className="flex items-center gap-3 py-2.5 px-1 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
            >
              <div className="shrink-0 w-[22px] flex justify-center">
                <preset.icon size={16} className="text-zinc-400" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{preset.name}</span>
                <p className="text-xs text-zinc-500 truncate">{preset.description}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1"
                onClick={() => handleOpenPresetDialog(preset)}
              >
                + 连接
              </Button>
            </div>
          ))}
        </SettingsCard>
      )}

      {/* Connect / Edit Dialog */}
      <ConnectDialog
        preset={connectPreset}
        open={connectDialogOpen}
        onOpenChange={(open) => {
          setConnectDialogOpen(open)
          if (!open) setEditProvider(null)
        }}
        onSave={editProvider ? handleEditSave : handleConnect}
        editProvider={editProvider}
      />

      {/* Delete Confirmation */}
      <DeleteDialog
        provider={deleteTarget}
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={handleDelete}
      />
    </div>
  )
}
