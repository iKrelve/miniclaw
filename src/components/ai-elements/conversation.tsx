/**
 * Conversation — auto-scroll container and layout primitives.
 * Based on use-stick-to-bottom for smart auto-scroll behavior.
 */

import type { ComponentProps } from 'react'
import { useCallback } from 'react'
import { ArrowDown } from '@phosphor-icons/react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import { cn } from '../../lib/utils'

export type ConversationProps = ComponentProps<typeof StickToBottom>

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn('relative flex-1 overflow-y-hidden', className)}
    initial="smooth"
    resize="instant"
    role="log"
    {...props}
  />
)

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content className={cn('flex flex-col gap-8 p-4', className)} {...props} />
)

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string
  description?: string
  icon?: React.ReactNode
}

export const ConversationEmptyState = ({
  className,
  title = 'No messages yet',
  description = 'Start a conversation to see messages here',
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
      </>
    )}
  </div>
)

export type ConversationScrollButtonProps = ComponentProps<'button'>

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()

  const handle = useCallback(() => {
    scrollToBottom()
  }, [scrollToBottom])

  if (isAtBottom) return null

  return (
    <button
      type="button"
      className={cn(
        'absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full',
        'border border-border bg-background dark:bg-background dark:hover:bg-muted',
        'p-2 shadow-md hover:bg-muted transition-colors',
        className,
      )}
      onClick={handle}
      {...props}
    >
      <ArrowDown className="size-4" />
    </button>
  )
}
