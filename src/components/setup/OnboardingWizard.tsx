/**
 * OnboardingWizard — Card-based setup center (inspired by CodePilot)
 *
 * All setup steps are displayed in a single, compact card container instead of
 * a paginated full-screen wizard. This eliminates the "empty lower half" issue
 * and gives users a clear overview of the setup progress.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSidecar } from '../../hooks/useSidecar';
import { Button } from '../ui/button';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Rocket,
  MessageSquare,
  Puzzle,
  FolderGit2,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface OnboardingWizardProps {
  onComplete: () => void;
}

/* ------------------------------------------------------------------ */
/* Feature highlight cards                                             */
/* ------------------------------------------------------------------ */

const features = [
  { icon: MessageSquare, title: 'AI 对话', desc: '基于 Claude Code SDK 的智能对话' },
  { icon: Puzzle,        title: 'MCP 插件', desc: '可扩展的 MCP 服务器集成' },
  { icon: FolderGit2,    title: '项目管理', desc: '文件浏览、Git 操作一站搞定' },
  { icon: Sparkles,      title: '多模型',   desc: '支持 Anthropic / OpenAI 等多个模型' },
];

/* ------------------------------------------------------------------ */
/* Status badge                                                        */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: 'done' | 'pending' | 'error' }) {
  if (status === 'done') {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <CheckCircle size={14} /> 就绪
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        <XCircle size={14} /> 未就绪
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-zinc-400">
      <Loader2 size={14} className="animate-spin" /> 检测中
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { baseUrl } = useSidecar();

  // Sidecar health check
  const [sidecarStatus, setSidecarStatus] = useState<'pending' | 'done' | 'error'>('pending');

  // Provider form
  const [providerOpen, setProviderOpen] = useState(false);
  const [providerName, setProviderName] = useState('');
  const [providerType, setProviderType] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [providerDone, setProviderDone] = useState(false);

  // Check sidecar on mount
  useEffect(() => {
    if (!baseUrl) return;
    fetch(`${baseUrl}/health`)
      .then((res) => (res.ok ? setSidecarStatus('done') : setSidecarStatus('error')))
      .catch(() => setSidecarStatus('error'));
  }, [baseUrl]);

  // Retry sidecar check every 3s if not connected
  useEffect(() => {
    if (sidecarStatus !== 'error' || !baseUrl) return;
    const id = setInterval(() => {
      fetch(`${baseUrl}/health`)
        .then((res) => {
          if (res.ok) {
            setSidecarStatus('done');
            clearInterval(id);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [sidecarStatus, baseUrl]);

  const handleSaveProvider = useCallback(async () => {
    if (!baseUrl || !providerName || !apiKey) return;
    setSaving(true);
    try {
      await fetch(`${baseUrl}/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: providerName, type: providerType, api_key: apiKey }),
      });
      setProviderDone(true);
      setProviderOpen(false);
    } catch {
      // error
    } finally {
      setSaving(false);
    }
  }, [baseUrl, providerName, providerType, apiKey]);

  const handleFinish = useCallback(async () => {
    if (!baseUrl) return;
    await fetch(`${baseUrl}/settings/onboarding_complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'true' }),
    }).catch(() => {});
    onComplete();
  }, [baseUrl, onComplete]);

  const completedCount = [sidecarStatus === 'done', providerDone].filter(Boolean).length;

  return (
    <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-zinc-50 to-blue-50/50 dark:from-zinc-950 dark:to-blue-950/20 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden">
        {/* ── Header ── */}
        <div className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="text-4xl">🦞</div>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                欢迎使用小龙虾
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                精简的 Claude Code 桌面客户端
              </p>
            </div>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {completedCount}/2 完成
            </span>
          </div>
        </div>

        {/* ── Feature highlights ── */}
        <div className="px-6 pt-4 pb-2">
          <div className="grid grid-cols-2 gap-2">
            {features.map((f) => (
              <div
                key={f.title}
                className="flex items-start gap-2.5 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 p-3"
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 shrink-0">
                  <f.icon size={16} className="text-blue-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{f.title}</p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Setup cards ── */}
        <div className="px-6 py-4 space-y-3">
          {/* Card: Sidecar status */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Sidecar 服务
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {sidecarStatus === 'done'
                    ? 'Bun 后端服务已就绪'
                    : sidecarStatus === 'error'
                      ? '正在等待服务启动...'
                      : '正在检测服务状态...'}
                </p>
              </div>
              <StatusBadge status={sidecarStatus} />
            </div>
          </div>

          {/* Card: API Provider */}
          <div
            className={cn(
              'rounded-xl border p-4 transition-colors',
              providerDone
                ? 'border-green-200 dark:border-green-800/50'
                : 'border-zinc-200 dark:border-zinc-700',
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  AI Provider
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {providerDone ? '已配置' : '配置 API Key 以开始使用（可选）'}
                </p>
              </div>
              {providerDone ? (
                <StatusBadge status="done" />
              ) : (
                <button
                  onClick={() => setProviderOpen(!providerOpen)}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  {providerOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              )}
            </div>

            {/* Expandable form */}
            {providerOpen && !providerDone && (
              <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2.5">
                <input
                  type="text"
                  placeholder="名称 (如 My Anthropic)"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                <select
                  value={providerType}
                  onChange={(e) => setProviderType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google (Gemini)</option>
                  <option value="bedrock">AWS Bedrock</option>
                  <option value="vertex">Google Vertex</option>
                </select>
                <input
                  type="password"
                  placeholder="API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                <Button
                  size="sm"
                  onClick={handleSaveProvider}
                  disabled={!providerName || !apiKey || saving}
                  className="w-full"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : '保存'}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="px-6 pb-6 pt-2 flex items-center gap-3">
          <Button
            size="lg"
            onClick={handleFinish}
            className="flex-1 gap-2"
          >
            <Rocket size={16} />
            进入小龙虾
          </Button>
          <button
            onClick={handleFinish}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors whitespace-nowrap"
          >
            跳过设置
          </button>
        </div>
      </div>
    </div>
  );
}
