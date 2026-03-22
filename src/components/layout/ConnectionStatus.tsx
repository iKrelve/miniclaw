/**
 * ConnectionStatus — Shows sidecar connection state in the sidebar footer.
 */

import { useSidecar } from '../../hooks/useSidecar';
import { Circle, Loader2 } from 'lucide-react';

export function ConnectionStatus() {
  const { ready, error, port } = useSidecar();

  return (
    <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-2 text-xs text-zinc-500">
      {error ? (
        <>
          <Circle size={6} className="fill-red-500 text-red-500" />
          <span className="truncate text-red-500">{error}</span>
        </>
      ) : ready ? (
        <>
          <Circle size={6} className="fill-green-500 text-green-500" />
          <span>已连接</span>
          <span className="text-zinc-400 ml-auto">:{port}</span>
        </>
      ) : (
        <>
          <Loader2 size={12} className="animate-spin text-blue-500" />
          <span>连接中...</span>
        </>
      )}
    </div>
  );
}