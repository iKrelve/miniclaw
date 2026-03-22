/**
 * PermissionPrompt — enhanced permission UI with:
 * - Confirmation component pattern (Title/Request/Accepted/Rejected)
 * - Allow Once / Allow for Session / Deny buttons
 * - AskUserQuestion support (multi-select/single-select + custom input)
 * - ExitPlanMode support (plan approval with feedback)
 * - Tool input preview
 *
 * Aligned with CodePilot's PermissionPrompt architecture.
 */

import { useState, useEffect, useRef } from 'react'
import { Shield, Check, X } from 'lucide-react'
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
  type ToolUIPartState,
} from '../ai-elements/confirmation'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

// ── Types ──────────────────────────────────────────────────────────────

interface PermissionRequest {
  id: string
  tool_name: string
  description: string
  input: unknown
}

interface PermissionPromptProps {
  request: PermissionRequest
  onAllow: (id: string, updatedInput?: Record<string, unknown>) => void
  onDeny: (id: string, message?: string) => void
  onAllowSession?: (id: string) => void
  permissionProfile?: 'default' | 'full_access'
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
  onSubmit,
}: {
  input: Record<string, unknown>
  onSubmit: (updatedInput: Record<string, unknown>) => void
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
    // Collect answers — keyed by question text (matching CodePilot's format)
    const answers: Record<string, string> = {}
    questions.forEach((q, i) => {
      const qIdx = String(i)
      const selected = Array.from(selections[qIdx] || [])
      if (useOther[qIdx] && otherTexts[qIdx]?.trim()) {
        selected.push(otherTexts[qIdx].trim())
      }
      answers[q.question] = selected.join(', ')
    })
    // Pass the full updated input back to the SDK
    onSubmit({ questions: input.questions, answers })
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
                        ? 'border-primary bg-primary/10 text-primary'
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
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                }
              >
                其他
              </Button>
            </div>
            {useOther[qIdx] && (
              <Input
                type="text"
                placeholder="输入你的答案..."
                value={otherTexts[qIdx] || ''}
                onChange={(e) => setOtherTexts((prev) => ({ ...prev, [qIdx]: e.target.value }))}
                className="text-xs"
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

// ── ExitPlanMode UI ────────────────────────────────────────────────────

function ExitPlanModeUI({
  toolInput,
  onApprove,
  onDeny,
  onDenyWithMessage,
}: {
  toolInput: Record<string, unknown>
  onApprove: () => void
  onDeny: () => void
  onDenyWithMessage: (message: string) => void
}) {
  const [feedback, setFeedback] = useState('')
  const allowedPrompts = (toolInput.allowedPrompts || []) as Array<{
    tool: string
    prompt: string
  }>

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
        >
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        <span className="text-sm font-medium">计划已完成 — 准备执行</span>
      </div>
      {allowedPrompts.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">请求的权限：</p>
          <ul className="space-y-0.5">
            {allowedPrompts.map((p, i) => (
              <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  {p.tool}
                </span>
                <span>{p.prompt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onDeny} className="text-xs">
          拒绝
        </Button>
        <Button size="sm" onClick={onApprove} className="text-xs">
          批准并执行
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder="给计划提供反馈..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && feedback.trim()) {
              onDenyWithMessage(feedback.trim())
            }
          }}
          className="flex-1 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (feedback.trim()) onDenyWithMessage(feedback.trim())
          }}
          disabled={!feedback.trim()}
          className="text-xs"
        >
          改为这样做
        </Button>
      </div>
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
  permissionProfile,
}: PermissionPromptProps) {
  const [resolved, setResolved] = useState<'allow' | 'deny' | null>(null)
  const inp = (
    typeof request.input === 'object' && request.input !== null ? request.input : {}
  ) as Record<string, unknown>

  const displayName = request.tool_name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()

  // Auto-approve when full_access is active
  const autoApprovedRef = useRef(false)
  useEffect(() => {
    if (permissionProfile === 'full_access' && !resolved && !autoApprovedRef.current) {
      autoApprovedRef.current = true
      setResolved('allow')
      onAllow(request.id)
    }
  }, [permissionProfile, resolved, onAllow, request.id])

  // Don't render UI when full_access
  if (permissionProfile === 'full_access') return null

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
          onSubmit={(updatedInput) => {
            setResolved('allow')
            onAllow(request.id, updatedInput)
          }}
        />
      </div>
    )
  }

  // ExitPlanMode has a custom UI
  if (request.tool_name === 'ExitPlanMode') {
    if (resolved === 'allow') {
      return (
        <div className="my-3 px-4 py-2">
          <p className="text-xs text-status-success-foreground">计划已批准 — 正在执行</p>
        </div>
      )
    }
    if (resolved === 'deny') {
      return (
        <div className="my-3 px-4 py-2">
          <p className="text-xs text-status-error-foreground">计划已拒绝</p>
        </div>
      )
    }
    return (
      <div className="my-3">
        <ExitPlanModeUI
          toolInput={inp}
          onApprove={() => {
            setResolved('allow')
            onAllow(request.id)
          }}
          onDeny={() => {
            setResolved('deny')
            onDeny(request.id)
          }}
          onDenyWithMessage={(msg) => {
            setResolved('deny')
            onDeny(request.id, msg)
          }}
        />
      </div>
    )
  }

  // Generic permission confirmation using Confirmation component
  const getState = (): ToolUIPartState => {
    if (resolved) return 'approval-responded'
    return 'approval-requested'
  }

  const getApproval = () => {
    if (resolved === 'allow') return { id: request.id, approved: true as const }
    if (resolved === 'deny') return { id: request.id, approved: false as const }
    return { id: request.id }
  }

  return (
    <div className="my-3">
      <Confirmation approval={getApproval()} state={getState()}>
        <ConfirmationTitle>
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-status-warning-foreground" />
            <span className="font-semibold text-sm">权限请求</span>
          </div>
          <div className="mt-1">
            <span className="font-medium">{displayName}</span>
            {request.description && (
              <span className="text-muted-foreground ml-2">— {request.description}</span>
            )}
          </div>
        </ConfirmationTitle>

        {/* Tool input preview */}
        {request.input != null && (
          <pre className="mt-1 text-xs bg-muted/50 rounded-lg p-2 overflow-x-auto max-h-32 overflow-y-auto font-mono">
            {formatToolInput(inp)}
          </pre>
        )}

        <ConfirmationRequest>
          <ConfirmationActions>
            <ConfirmationAction
              variant="outline"
              onClick={() => {
                setResolved('deny')
                onDeny(request.id)
              }}
              className="border-status-error-border text-status-error-foreground hover:bg-status-error-muted"
            >
              <X size={14} className="mr-1" />
              拒绝
            </ConfirmationAction>
            <ConfirmationAction
              variant="outline"
              onClick={() => {
                setResolved('allow')
                onAllow(request.id)
              }}
            >
              <Check size={14} className="mr-1" />
              允许一次
            </ConfirmationAction>
            {onAllowSession && (
              <ConfirmationAction
                variant="default"
                onClick={() => {
                  setResolved('allow')
                  onAllowSession(request.id)
                }}
              >
                允许本次会话
              </ConfirmationAction>
            )}
          </ConfirmationActions>
        </ConfirmationRequest>

        <ConfirmationAccepted>
          <p className="text-xs text-status-success-foreground">已允许 — {displayName}</p>
        </ConfirmationAccepted>

        <ConfirmationRejected>
          <p className="text-xs text-status-error-foreground">已拒绝 — {displayName}</p>
        </ConfirmationRejected>
      </Confirmation>
    </div>
  )
}
