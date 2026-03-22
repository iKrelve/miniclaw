/**
 * SettingsView — Application settings panel
 */

import { useEffect, useState } from 'react';
import { useSidecar } from '../../hooks/useSidecar';
import { ThemeSelector } from './ThemeSelector';

interface Provider {
  id: string;
  name: string;
  type: string;
  api_key: string;
  base_url: string;
  is_active: number;
}

export function SettingsView() {
  const { baseUrl } = useSidecar();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [newProvider, setNewProvider] = useState({ name: '', type: 'anthropic', api_key: '', base_url: '' });

  useEffect(() => {
    if (!baseUrl) return;
    fetch(`${baseUrl}/providers`)
      .then((res) => res.json())
      .then((data) => setProviders(data.providers || []))
      .catch(() => {});
  }, [baseUrl]);

  const handleAddProvider = async () => {
    if (!baseUrl || !newProvider.name || !newProvider.api_key) return;
    try {
      const res = await fetch(`${baseUrl}/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProvider),
      });
      const data = await res.json();
      if (data.provider) {
        setProviders((prev) => [...prev, data.provider]);
        setNewProvider({ name: '', type: 'anthropic', api_key: '', base_url: '' });
      }
    } catch {
      // error
    }
  };

  const handleActivate = async (id: string) => {
    if (!baseUrl) return;
    await fetch(`${baseUrl}/providers/${id}/activate`, { method: 'POST' });
    // Refresh
    const res = await fetch(`${baseUrl}/providers`);
    const data = await res.json();
    setProviders(data.providers || []);
  };

  const handleDelete = async (id: string) => {
    if (!baseUrl) return;
    await fetch(`${baseUrl}/providers/${id}`, { method: 'DELETE' });
    setProviders((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">设置</h1>

      {/* Theme Selection */}
      <ThemeSelector />

      {/* API Providers */}
      <section>
        <h2 className="text-lg font-semibold mb-4">API Providers</h2>

        {/* Existing providers */}
        <div className="space-y-2 mb-4">
          {providers.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
            >
              <div>
                <div className="font-medium text-sm">{p.name}</div>
                <div className="text-xs text-zinc-500">{p.type} • {p.api_key ? '••••' + p.api_key.slice(-4) : 'No key'}</div>
              </div>
              <div className="flex items-center gap-2">
                {p.is_active ? (
                  <span className="text-xs text-green-600 font-medium">✓ Active</span>
                ) : (
                  <button
                    onClick={() => handleActivate(p.id)}
                    className="text-xs text-blue-500 hover:text-blue-600"
                  >
                    Activate
                  </button>
                )}
                <button
                  onClick={() => handleDelete(p.id)}
                  className="text-xs text-red-500 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add new provider */}
        <div className="space-y-3 p-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <h3 className="text-sm font-medium">添加 Provider</h3>
          <input
            type="text"
            placeholder="Name"
            value={newProvider.name}
            onChange={(e) => setNewProvider((p) => ({ ...p, name: e.target.value }))}
            className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
          />
          <select
            value={newProvider.type}
            onChange={(e) => setNewProvider((p) => ({ ...p, type: e.target.value }))}
            className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google</option>
            <option value="bedrock">AWS Bedrock</option>
            <option value="vertex">Google Vertex</option>
          </select>
          <input
            type="password"
            placeholder="API Key"
            value={newProvider.api_key}
            onChange={(e) => setNewProvider((p) => ({ ...p, api_key: e.target.value }))}
            className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
          />
          <input
            type="text"
            placeholder="Base URL (optional)"
            value={newProvider.base_url}
            onChange={(e) => setNewProvider((p) => ({ ...p, base_url: e.target.value }))}
            className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
          />
          <button
            onClick={handleAddProvider}
            disabled={!newProvider.name || !newProvider.api_key}
            className="w-full py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
          >
            添加
          </button>
        </div>
      </section>
    </div>
  );
}
