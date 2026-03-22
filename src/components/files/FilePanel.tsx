/**
 * FilePanel — File tree browser with file preview.
 */

import { useEffect, useState, useCallback } from 'react';
import { useSidecar } from '../../hooks/useSidecar';
import { Folder, File, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { MarkdownRenderer } from '../chat/MarkdownRenderer';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
}

interface FilePreviewData {
  path: string;
  content: string;
  language: string;
  line_count: number;
}

function TreeNode({ node, depth, onSelect }: { node: FileNode; depth: number; onSelect: (path: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const isDir = node.type === 'directory';

  return (
    <div>
      <button
        onClick={() => isDir ? setOpen(!open) : onSelect(node.path)}
        className={cn(
          'w-full flex items-center gap-1.5 py-1 px-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir ? (
          open ? <ChevronDown size={12} /> : <ChevronRight size={12} />
        ) : (
          <span className="w-3" />
        )}
        {isDir ? (
          <Folder size={14} className="text-blue-500 shrink-0" />
        ) : (
          <File size={14} className="text-zinc-400 shrink-0" />
        )}
        <span className="truncate text-zinc-700 dark:text-zinc-300">{node.name}</span>
      </button>
      {isDir && open && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function FilePanel() {
  const { baseUrl } = useSidecar();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [root, setRoot] = useState('');
  const [preview, setPreview] = useState<FilePreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTree = useCallback(async (dir?: string) => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const url = dir ? `${baseUrl}/files/browse?path=${encodeURIComponent(dir)}` : `${baseUrl}/files/browse`;
      const res = await fetch(url);
      const data = await res.json();
      setTree(data.tree || []);
      setRoot(data.root || '');
    } catch {
      // error
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => { loadTree(); }, [loadTree]);

  const handleSelect = useCallback(async (path: string) => {
    if (!baseUrl) return;
    try {
      const res = await fetch(`${baseUrl}/files/preview?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        setPreview(await res.json());
      }
    } catch {
      // error
    }
  }, [baseUrl]);

  return (
    <div className="flex-1 flex min-h-0">
      {/* File tree */}
      <div className="w-64 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-xs font-medium text-zinc-500 truncate">{root}</span>
          <Button variant="ghost" size="icon" onClick={() => loadTree()} disabled={loading} className="h-6 w-6">
            <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
          </Button>
        </div>
        <div className="py-1">
          {tree.map((node) => (
            <TreeNode key={node.path} node={node} depth={0} onSelect={handleSelect} />
          ))}
        </div>
      </div>

      {/* File preview */}
      <div className="flex-1 overflow-auto">
        {preview ? (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-medium">{preview.path.split('/').pop()}</div>
                <div className="text-xs text-zinc-500">{preview.language} · {preview.line_count} lines</div>
              </div>
            </div>
            <MarkdownRenderer content={`\`\`\`${preview.language}\n${preview.content}\n\`\`\``} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
            选择文件预览
          </div>
        )}
      </div>
    </div>
  );
}