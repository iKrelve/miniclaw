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
    <div className="my-3 rounded-xl border-2 border-status-warning-border bg-status-warning-muted overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-status-warning-border">
        <Shield size={16} className="text-status-warning-foreground" />
        <span className="text-sm font-semibold text-foreground">权限请求</span>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        <div>
          <div className="text-sm font-medium text-foreground">{displayName}</div>
          {request.description && (
            <div className="text-xs text-muted-foreground mt-1">{request.description}</div>
          )}
        </div>

        {/* Tool input preview */}
        {request.input != null && (
          <pre className="text-xs bg-background rounded-lg p-2 overflow-x-auto max-h-32 overflow-y-auto border border-status-warning-border">
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
            className="bg-status-success text-white hover:bg-status-success/90"
          >
            <Check size={14} />
            允许
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDeny(request.id)}
            className={cn(
              'border-status-error-border text-status-error-foreground hover:bg-status-error-muted',
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
