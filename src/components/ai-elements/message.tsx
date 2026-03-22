/**
 * Message — layout primitives for chat messages.
 * Provides user/assistant styling and Streamdown-based Markdown rendering.
 */

import type { HTMLAttributes, ComponentProps } from 'react'
import { memo } from 'react'
import { cjk } from '@streamdown/cjk'
import { createCodePlugin } from '@streamdown/code'
import { math } from '@streamdown/math'
import { Streamdown } from 'streamdown'
import { cn } from '../../lib/utils'

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: 'user' | 'assistant'
}

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      'group flex w-full max-w-[95%] flex-col gap-2',
      from === 'user' ? 'is-user ml-auto justify-end' : 'is-assistant',
      className,
    )}
    {...props}
  />
)

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      'flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm',
      // User bubble styling
      'group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-blue-500 group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-white',
      // Assistant: full width, normal text
      'group-[.is-assistant]:w-full group-[.is-assistant]:text-zinc-900 group-[.is-assistant]:dark:text-zinc-100',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

// Streamdown plugins — code highlighting with safe fallback for unsupported languages
const _code = createCodePlugin()
const safeCode: typeof _code = {
  ..._code,
  highlight(params, callback) {
    if (!_code.supportsLanguage(params.language)) {
      return null // Let Streamdown render as plain text
    }
    return _code.highlight(params, callback)
  },
}
const plugins = { cjk, code: safeCode, math }

export type MessageResponseProps = ComponentProps<typeof Streamdown>

/**
 * MessageResponse — Streamdown-based Markdown renderer.
 * Replaces the old MarkdownRenderer (react-markdown).
 */
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn('size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
      plugins={plugins}
      {...props}
    />
  ),
  (prev, next) => prev.children === next.children,
)

MessageResponse.displayName = 'MessageResponse'
