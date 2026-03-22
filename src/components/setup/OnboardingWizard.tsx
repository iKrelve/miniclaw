/**
 * OnboardingWizard — First-run setup that guides users through:
 * 1. Welcome screen
 * 2. Claude binary detection
 * 3. API Provider configuration
 * 4. Working directory selection
 */

import { useState, useEffect } from 'react';
import { useSidecar } from '../../hooks/useSidecar';
import { Button } from '../ui/button';
import { CheckCircle, XCircle, Loader2, ArrowRight, Rocket } from 'lucide-react';

type Step = 'welcome' | 'claude' | 'provider' | 'done';

interface OnboardingWizardProps {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { baseUrl } = useSidecar();
  const [step, setStep] = useState<Step>('welcome');
  const [claudeFound, setClaudeFound] = useState<boolean | null>(null);
  const [providerName, setProviderName] = useState('');
  const [providerType, setProviderType] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  // Check Claude binary when entering that step
  useEffect(() => {
    if (step !== 'claude' || !baseUrl) return;
    fetch(`${baseUrl}/health`)
      .then((res) => res.json())
      .then(() => setClaudeFound(true))
      .catch(() => setClaudeFound(false));
  }, [step, baseUrl]);

  const handleSaveProvider = async () => {
    if (!baseUrl || !providerName || !apiKey) return;
    setSaving(true);
    try {
      await fetch(`${baseUrl}/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: providerName, type: providerType, api_key: apiKey }),
      });
      // Mark onboarding complete
      await fetch(`${baseUrl}/settings/onboarding_complete`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'true' }),
      });
      setStep('done');
    } catch {
      // error
    } finally {
      setSaving(false);
    }
  };

  const skipProvider = async () => {
    if (!baseUrl) return;
    await fetch(`${baseUrl}/settings/onboarding_complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'true' }),
    }).catch(() => {});
    setStep('done');
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-zinc-50 to-blue-50 dark:from-zinc-950 dark:to-blue-950/30">
      <div className="w-full max-w-md p-8 space-y-6">
        {/* Welcome */}
        {step === 'welcome' && (
          <div className="text-center space-y-6">
            <div className="text-7xl">🦞</div>
            <h1 className="text-3xl font-bold">欢迎使用小龙虾</h1>
            <p className="text-zinc-500 dark:text-zinc-400">
              一个精简的 Claude Code 桌面客户端
            </p>
            <Button size="lg" onClick={() => setStep('claude')} className="w-full">
              开始设置 <ArrowRight size={16} />
            </Button>
          </div>
        )}

        {/* Claude detection */}
        {step === 'claude' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-center">检测 Claude CLI</h2>
            <div className="flex items-center justify-center gap-3 p-6 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              {claudeFound === null && <Loader2 size={24} className="animate-spin text-blue-500" />}
              {claudeFound === true && <CheckCircle size={24} className="text-green-500" />}
              {claudeFound === false && <XCircle size={24} className="text-amber-500" />}
              <span className="text-sm">
                {claudeFound === null && '检测中...'}
                {claudeFound === true && 'Sidecar 服务已就绪'}
                {claudeFound === false && 'Sidecar 连接中，请稍候'}
              </span>
            </div>
            <Button size="lg" onClick={() => setStep('provider')} className="w-full">
              下一步 <ArrowRight size={16} />
            </Button>
          </div>
        )}

        {/* Provider config */}
        {step === 'provider' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-center">配置 AI Provider</h2>
            <p className="text-sm text-zinc-500 text-center">
              添加你的 API Key 来开始使用，也可以跳过稍后配置
            </p>
            <input
              type="text"
              placeholder="名称 (如 My Anthropic)"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm"
            />
            <select
              value={providerType}
              onChange={(e) => setProviderType(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm"
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
              className="w-full px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm"
            />
            <Button size="lg" onClick={handleSaveProvider} disabled={!providerName || !apiKey || saving} className="w-full">
              {saving ? <Loader2 size={16} className="animate-spin" /> : '保存并继续'}
            </Button>
            <button onClick={skipProvider} className="w-full text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
              跳过，稍后配置
            </button>
          </div>
        )}

        {/* Done */}
        {step === 'done' && (
          <div className="text-center space-y-6">
            <Rocket size={64} className="mx-auto text-blue-500" />
            <h2 className="text-xl font-bold">设置完成！</h2>
            <p className="text-zinc-500">开始和 AI 助手对话吧</p>
            <Button size="lg" onClick={onComplete} className="w-full">
              进入小龙虾
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}