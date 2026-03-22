/**
 * ModelSelector — Dropdown for switching AI model within a chat session.
 */

import { useState, useEffect } from 'react';
import { useSidecar } from '../../hooks/useSidecar';
import { useAppStore } from '../../stores';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface CatalogModel {
  id: string;
  name: string;
  provider: string;
}

interface ModelSelectorProps {
  onModelChange?: (modelId: string) => void;
}

export function ModelSelector({ onModelChange }: ModelSelectorProps) {
  const { baseUrl } = useSidecar();
  const { activeSessionId, sessions } = useAppStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(activeSession?.model || '');

  useEffect(() => {
    if (!baseUrl) return;
    fetch(`${baseUrl}/providers/models`)
      .then((res) => res.json())
      .then((data) => setModels(data.models || []))
      .catch(() => {});
  }, [baseUrl]);

  useEffect(() => {
    setSelected(activeSession?.model || '');
  }, [activeSession]);

  const handleSelect = (modelId: string) => {
    setSelected(modelId);
    setOpen(false);
    onModelChange?.(modelId);
  };

  const currentModel = models.find((m) => m.id === selected);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
      >
        <span className="truncate max-w-[120px]">{currentModel?.name || selected || 'Select model'}</span>
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-1 z-50 w-64 max-h-72 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg">
            {models.length === 0 && (
              <div className="px-3 py-4 text-xs text-zinc-400 text-center">
                无可用模型（请先配置 Provider）
              </div>
            )}
            {/* Group by provider */}
            {Object.entries(
              models.reduce<Record<string, CatalogModel[]>>((acc, m) => {
                (acc[m.provider] ??= []).push(m);
                return acc;
              }, {}),
            ).map(([provider, providerModels]) => (
              <div key={provider}>
                <div className="px-3 py-1.5 text-[10px] uppercase font-medium text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                  {provider}
                </div>
                {providerModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleSelect(m.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors',
                      m.id === selected && 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
                    )}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}