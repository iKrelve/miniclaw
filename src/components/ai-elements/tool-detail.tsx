/**
 * Tool — structured tool call display with collapsible content.
 * Adapted from CodePilot's ai-elements/tool.tsx.
 *
 * Uses local type definitions instead of Vercel AI SDK's ToolUIPart.
 */

import {
  type ComponentProps,
  type ReactNode,
  createContext,
  isValidElement,
  useContext,
  useState,
} from 'react'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { CheckCircle, CaretDown, Circle, Clock, Wrench, XCircle } from '@phosphor-icons/react'
import { CodeBlock } from './code-block'

// Local type for tool state (replaces ToolUIPart['state'])
type ToolState =
  | 'approval-requested'
  | 'approval-responded'
  | 'input-available'
  | 'input-streaming'
  | 'output-available'
  | 'output-denied'
  | 'output-error'

// Context to track if tool content has been opened (for lazy rendering)
const ToolOpenContext = createContext<boolean>(false)

export type ToolProps = ComponentProps<typeof Collapsible>

export const Tool = ({ className, defaultOpen = false, ...props }: ToolProps) => {
  const [hasBeenOpened, setHasBeenOpened] = useState(defaultOpen)

  return (
    <ToolOpenContext.Provider value={hasBeenOpened}>
      <Collapsible
        className={cn('group not-prose mb-4 w-full rounded-md border', className)}
        defaultOpen={defaultOpen}
        onOpenChange={(open) => {
          if (open && !hasBeenOpened) {
            setHasBeenOpened(true)
          }
          props.onOpenChange?.(open)
        }}
        {...props}
      />
    </ToolOpenContext.Provider>
  )
}

export type ToolHeaderProps = {
  title?: string
  className?: string
  state: ToolState
  toolName?: string
}

const statusLabels: Record<ToolState, string> = {
  'approval-requested': '等待审批',
  'approval-responded': '已响应',
  'input-available': '运行中',
  'input-streaming': '准备中',
  'output-available': '已完成',
  'output-denied': '已拒绝',
  'output-error': '错误',
}

const statusIcons: Record<ToolState, ReactNode> = {
  'approval-requested': <Clock className="size-4 text-yellow-600" />,
  'approval-responded': <CheckCircle className="size-4 text-blue-600" />,
  'input-available': <Clock className="size-4 animate-pulse" />,
  'input-streaming': <Circle className="size-4" />,
  'output-available': <CheckCircle className="size-4 text-green-600" />,
  'output-denied': <XCircle className="size-4 text-orange-600" />,
  'output-error': <XCircle className="size-4 text-red-600" />,
}

export const getStatusBadge = (status: ToolState) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
)

export const ToolHeader = ({ className, title, state, toolName, ...props }: ToolHeaderProps) => {
  return (
    <CollapsibleTrigger
      className={cn('flex w-full items-center justify-between gap-4 p-3', className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <Wrench className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? toolName}</span>
        {getStatusBadge(state)}
      </div>
      <CaretDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  )
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export const ToolContent = ({ className, children, ...props }: ToolContentProps) => {
  const hasBeenOpened = useContext(ToolOpenContext)

  return (
    <CollapsibleContent
      className={cn(
        'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
        className,
      )}
      {...props}
    >
      {hasBeenOpened ? children : null}
    </CollapsibleContent>
  )
}

export type ToolInputProps = ComponentProps<'div'> & {
  input: Record<string, unknown>
}

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn('space-y-2 overflow-hidden', className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
)

export type ToolOutputProps = ComponentProps<'div'> & {
  output: unknown
  errorText?: string
}

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null
  }

  let Output = <div>{output as ReactNode}</div>

  if (typeof output === 'object' && !isValidElement(output)) {
    Output = <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
  } else if (typeof output === 'string') {
    Output = <CodeBlock code={output} language="json" />
  }

  return (
    <div className={cn('space-y-2', className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? 'Error' : 'Result'}
      </h4>
      <div
        className={cn(
          'overflow-x-auto rounded-md text-xs [&_table]:w-full',
          errorText ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground',
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  )
}

export type { ToolState }
