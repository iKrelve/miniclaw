/**
 * ProxySection — API Proxy / environment variable settings.
 *
 * Configures ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, etc.
 * Extracted from the old monolithic SettingsView.
 */

import { useEffect, useState } from 'react'
import { useSidecar } from '../../hooks/useSidecar'
import { Button } from '../ui/button'
import { SettingsCard } from './SettingsCard'
import { FieldRow } from './FieldRow'

interface ProxySettings {
  anthropic_base_url: string
  anthropic_auth_token: string
  anthropic_custom_headers: string
  anthropic_model: string
}

const PROXY_KEYS: (keyof ProxySettings)[] = [
  'anthropic_base_url',
  'anthropic_auth_token',
  'anthropic_custom_headers',
  'anthropic_model',
]

const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors'

export function ProxySection() {
  const { baseUrl } = useSidecar()
  const [proxy, setProxy] = useState<ProxySettings>({
    anthropic_base_url: '',
    anthropic_auth_token: '',
    anthropic_custom_headers: '',
    anthropic_model: '',
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!baseUrl) return
    fetch(`${baseUrl}/settings`)
      .then((res) => res.json())
      .then((data) => {
        const s = data.settings || data || {}
        setProxy({
          anthropic_base_url: s.anthropic_base_url || '',
          anthropic_auth_token: s.anthropic_auth_token || '',
          anthropic_custom_headers: s.anthropic_custom_headers || '',
          anthropic_model: s.anthropic_model || '',
        })
      })
      .catch(() => {})
  }, [baseUrl])

  const handleSave = async () => {
    if (!baseUrl) return
    const settings: Record<string, string> = {}
    for (const key of PROXY_KEYS) {
      settings[key] = proxy[key]
    }
    try {
      await fetch(`${baseUrl}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // error
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-sm font-medium">API 代理</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          配置自定义 API 代理，适用于企业网关或第三方代理。这些环境变量会传递给底层 Claude 进程。
        </p>
      </div>

      <SettingsCard>
        <FieldRow label="ANTHROPIC_BASE_URL" description="留空使用默认 Anthropic API 端点">
          <input
            type="text"
            placeholder="https://..."
            value={proxy.anthropic_base_url}
            onChange={(e) => setProxy((p) => ({ ...p, anthropic_base_url: e.target.value }))}
            className={`${inputClass} w-64`}
          />
        </FieldRow>

        <FieldRow label="ANTHROPIC_AUTH_TOKEN" description="API Key 或认证令牌" separator>
          <input
            type="password"
            placeholder="sk-..."
            value={proxy.anthropic_auth_token}
            onChange={(e) => setProxy((p) => ({ ...p, anthropic_auth_token: e.target.value }))}
            className={`${inputClass} w-64`}
          />
        </FieldRow>

        <FieldRow
          label="ANTHROPIC_CUSTOM_HEADERS"
          description="自定义请求头 (key:value 格式，可选)"
          separator
        >
          <input
            type="text"
            placeholder="key:value"
            value={proxy.anthropic_custom_headers}
            onChange={(e) => setProxy((p) => ({ ...p, anthropic_custom_headers: e.target.value }))}
            className={`${inputClass} w-64`}
          />
        </FieldRow>

        <FieldRow label="ANTHROPIC_MODEL" description="覆盖默认模型 (可选)" separator>
          <input
            type="text"
            placeholder="例如 deepseek-chat, gpt-4o"
            value={proxy.anthropic_model}
            onChange={(e) => setProxy((p) => ({ ...p, anthropic_model: e.target.value }))}
            className={`${inputClass} w-64`}
          />
        </FieldRow>

        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
          <Button onClick={handleSave} className="w-full">
            {saved ? '✓ 已保存' : '保存代理配置'}
          </Button>
        </div>
      </SettingsCard>
    </div>
  )
}
