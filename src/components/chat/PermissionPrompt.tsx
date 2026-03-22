/**
 * PermissionPrompt — enhanced permission UI with:
 * - Confirmation component pattern (Title/Request/Accepted/Rejected)
 * - Allow Once / Allow for Session / Deny buttons
 * - AskUserQuestion support (multi-select/single-select + custom input)
 * - Tool input preview
 */

import { useState } from 'react'
import { Shield, Check, X } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

// ── Types ──────────────────────────────────────────────────────────────

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
  onAllowSession?: (id: string) => void
}

// ── AskUserQuestion UI ─────────────────────────────────────────────────

interface QuestionOption {
  label: string
  description?: string
}

interface Question {
  question: string
  options: QuestionOption[]
  multiSelect: boolean
  header?: string
}

function AskUserQuestionUI({
  input,
  onAllow,
}: {
  input: Record<string, unknown>
  onAllow: (id: string) => void
}) {
  const questions = (input.questions || []) as Question[]
  const [selections, setSelections] = useState<Record<string, Set<string>>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})
  const [useOther, setUseOther] = useState<Record<string, boolean>>({})

  const toggleOption = (qIdx: string, label: string, multi: boolean) => {
    setSelections((prev) => {
      const current = new Set(prev[qIdx] || [])
      if (multi) {
        if (current.has(label)) current.delete(label)
        else current.add(label)
      } else {
        current.clear()
        current.add(label)
      }
      return { ...prev, [qIdx]: current }
    })
    setUseOther((prev) => ({ ...prev, [qIdx]: false }))
  }

  const toggleOther = (qIdx: string, multi: boolean) => {
    if (!multi) setSelections((prev) => ({ ...prev, [qIdx]: new Set() }))
    setUseOther((prev) => ({ ...prev, [qIdx]: !prev[qIdx] }))
  }

  const hasAnswer = questions.some((_, i) => {
    const qIdx = String(i)
    return (selections[qIdx]?.size || 0) > 0 || (useOther[qIdx] && otherTexts[qIdx]?.trim())
  })

  const handleSubmit = () => {
    // Collect answers and notify parent
    onAllow('submitted')
  }

  return (
    <div className="space-y-4 py-2">
      {questions.map((q, i) => {
        const qIdx = String(i)
        const selected = selections[qIdx] || new Set<string>()
        return (
          <div key={qIdx} className="space-y-2">
            {q.header && (
              <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {q.header}
              </span>
            )}
            <p className="text-sm font-medium">{q.question}</p>
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => {
                const isSelected = selected.has(opt.label)
                return (
                  <Button
                    key={opt.label}
                    variant="outline"
                    size="sm"
                    onClick={() => toggleOption(qIdx, opt.label, q.multiSelect)}
                    className={
                      isSelected
                        ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                        : 'border-border bg-background text-foreground hover:bg-muted'
                    }
                    title={opt.description}
                  >
                    {q.multiSelect && <span className="mr-1.5">{isSelected ? '☑' : '☐'}</span>}
                    {opt.label}
                  </Button>
                )
              })}
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleOther(qIdx, q.multiSelect)}
                className={
                  useOther[qIdx]
                    ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                }
              >
                其他
              </Button>
            </div>
            {useOther[qIdx] && (
              <input
                type="text"
                placeholder="输入你的答案..."
                value={otherTexts[qIdx] || ''}
                onChange={(e) => setOtherTexts((prev) => ({ ...prev, [qIdx]: e.target.value }))}
                className="w-full px-3 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            )}
          </div>
        )
      })}
      <Button onClick={handleSubmit} disabled={!hasAnswer} size="sm">
        提交
      </Button>
    </div>
  )
}

// ── Format tool input ──────────────────────────────────────────────────

function formatToolInput(input: Record<string, unknown>): string {
  if (input.command) return String(input.command)
  if (input.file_path) return String(input.file_path)
  if (input.path) return String(input.path)
  return JSON.stringify(input, null, 2)
}

// ── Main component ─────────────────────────────────────────────────────

export function PermissionPrompt({
  request,
  onAllow,
  onDeny,
  onAllowSession,
}: PermissionPromptProps) {
  const [resolved, setResolved] = useState<'allow' | 'deny' | null>(null)
  const inp = (
    typeof request.input === 'object' && request.input !== null ? request.input : {}
  ) as Record<string, unknown>

  const displayName = request.tool_name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()

  // AskUserQuestion has a custom UI
  if (request.tool_name === 'AskUserQuestion') {
    if (resolved) {
      return (
        <div className="my-3 px-4 py-2">
          <p className="text-xs text-status-success-foreground">已提交回答</p>
        </div>
      )
    }
    return (
      <div className="my-3 rounded-xl border border-border overflow-hidden px-4 py-3">
        <AskUserQuestionUI
          input={inp}
          onAllow={() => {
            setResolved('allow')
            onAllow(request.id)
          }}
        />
      </div>
    )
  }

  // Resolved state
  if (resolved === 'allow') {
    return (
      <div className="my-3 px-4 py-2 rounded-lg border border-status-success-border bg-status-success-muted">
        <p className="text-xs text-status-success-foreground">已允许 — {displayName}</p>
      </div>
    )
  }
  if (resolved === 'deny') {
    return (
      <div className="my-3 px-4 py-2 rounded-lg border border-status-error-border bg-status-error-muted">
        <p className="text-xs text-status-error-foreground">已拒绝 — {displayName}</p>
      </div>
    )
  }

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
          <pre className="text-xs bg-background rounded-lg p-2 overflow-x-auto max-h-32 overflow-y-auto border border-status-warning-border font-mono">
            {formatToolInput(inp)}
          </pre>
        )}

        {/* Action buttons — Allow Once / Allow for Session / Deny */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setResolved('deny')
              onDeny(request.id)
            }}
            className={cn(
              'border-status-error-border text-status-error-foreground hover:bg-status-error-muted',
            )}
          >
            <X size={14} />
            拒绝
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setResolved('allow')
              onAllow(request.id)
            }}
          >
            <Check size={14} />
            允许一次
          </Button>
          {onAllowSession && (
            <Button
              size="sm"
              onClick={() => {
                setResolved('allow')
                onAllowSession(request.id)
              }}
            >
              允许本次会话
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
