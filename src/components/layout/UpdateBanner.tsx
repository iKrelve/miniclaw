/**
 * UpdateBanner — Shows when an app update is available (Tauri updater).
 */

import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Download, X } from 'lucide-react';

export function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Check for updates via Tauri updater plugin
    let cancelled = false;
    async function check() {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!cancelled && update?.available) {
          setAvailable(true);
          setVersion(update.version || '');
        }
      } catch {
        // updater not available or check failed — silently ignore
      }
    }
    // Delay check by 5s to not slow startup
    const timer = setTimeout(check, 5000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update?.available) {
        await update.downloadAndInstall();
        // Tauri will prompt restart
      }
    } catch (err) {
      console.error('[updater] Install failed:', err);
      setInstalling(false);
    }
  };

  if (!available || dismissed) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 text-sm">
      <Download size={14} className="text-blue-500 shrink-0" />
      <span className="flex-1 text-blue-700 dark:text-blue-300">
        新版本 {version} 可用
      </span>
      <Button size="sm" onClick={handleInstall} disabled={installing}>
        {installing ? '安装中...' : '立即更新'}
      </Button>
      <button onClick={() => setDismissed(true)} className="text-blue-400 hover:text-blue-600">
        <X size={14} />
      </button>
    </div>
  );
}