/**
 * PermissionPrompt — UI for responding to tool permission requests.
 * Shows tool name, description, and allow/deny buttons.
 */

import { Shield, Check, X } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

interface PermissionRequest {
  id: string
  tool_name: string
  description: string
  input: unknown
}

interface PermissionPromptProps {
  request: PermissionRequest
  onAllow: (id: string) => void
  onDeny: (id: string) => void
}

export function PermissionPrompt({ request, onAllow, onDeny }: PermissionPromptProps) {
  // Format tool name
  const displayName = request.tool_name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()

  return (
    <div className="my-3 rounded-xl border-2 border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200 dark:border-amber-700">
        <Shield size={16} className="text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">权限请求</span>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        <div>
          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{displayName}</div>
          {request.description && (
            <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
              {request.description}
            </div>
          )}
        </div>

        {/* Tool input preview */}
        {request.input != null && (
          <pre className="text-xs bg-white dark:bg-zinc-900 rounded-lg p-2 overflow-x-auto max-h-32 overflow-y-auto border border-amber-200 dark:border-amber-800">
            {String(
              typeof request.input === 'string'
                ? request.input
                : JSON.stringify(request.input, null, 2),
            )}
          </pre>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => onAllow(request.id)}
            className="bg-green-500 hover:bg-green-600 text-white"
          >
            <Check size={14} />
            允许
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDeny(request.id)}
            className={cn(
              'border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20',
            )}
          >
            <X size={14} />
            拒绝
          </Button>
        </div>
      </div>
    </div>
  )
}
