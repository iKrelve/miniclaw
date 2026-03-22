/**
 * Terminal — styled terminal output with ANSI color support.
 * Adapted from CodePilot's ai-elements/terminal.tsx.
 */

import type { HTMLAttributes } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import Ansi from 'ansi-to-react'
import { Check, Copy, Terminal as TerminalIcon, Trash } from '@phosphor-icons/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Shimmer } from './shimmer'

interface TerminalContextType {
  output: string
  isStreaming: boolean
  autoScroll: boolean
  onClear?: () => void
}

const TerminalContext = createContext<TerminalContextType>({
  autoScroll: true,
  isStreaming: false,
  output: '',
})

export type TerminalProps = HTMLAttributes<HTMLDivElement> & {
  output?: string
  isStreaming?: boolean
  autoScroll?: boolean
  onClear?: () => void
}

export const Terminal = ({
  className,
  output = '',
  isStreaming = false,
  autoScroll = true,
  onClear,
  children,
  ...props
}: TerminalProps) => {
  const value = useMemo(
    () => ({ autoScroll, isStreaming, onClear, output }),
    [autoScroll, isStreaming, onClear, output],
  )

  return (
    <TerminalContext.Provider value={value}>
      <div
        className={cn(
          'not-prose flex flex-col overflow-hidden rounded-md border bg-zinc-950',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </TerminalContext.Provider>
  )
}

export type TerminalHeaderProps = HTMLAttributes<HTMLDivElement> & {
  title?: string
}

export const TerminalHeader = ({
  className,
  title = 'Terminal',
  children,
  ...props
}: TerminalHeaderProps) => {
  const { output, onClear, isStreaming } = useContext(TerminalContext)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }, [output])

  return (
    <div
      className={cn(
        'flex items-center justify-between border-b border-zinc-800 px-3 py-2',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <TerminalIcon className="size-3.5" />
        <span className="font-medium">
          {isStreaming ? <Shimmer duration={1.5}>{title}</Shimmer> : title}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {children}
        {onClear && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-300"
            onClick={onClear}
          >
            <Trash className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-300"
          onClick={handleCopy}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  )
}

export type TerminalContentProps = HTMLAttributes<HTMLDivElement>

export const TerminalContent = ({ className, ...props }: TerminalContentProps) => {
  const { output, autoScroll, isStreaming } = useContext(TerminalContext)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevOutputRef = useRef(output)

  useEffect(() => {
    if (autoScroll && scrollRef.current && output !== prevOutputRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevOutputRef.current = output
  }, [output, autoScroll])

  return (
    <div
      ref={scrollRef}
      className={cn(
        'max-h-80 overflow-auto px-3 py-2 font-mono text-xs text-zinc-200 leading-relaxed',
        className,
      )}
      {...props}
    >
      {output ? (
        <Ansi>{output}</Ansi>
      ) : isStreaming ? (
        <Shimmer duration={1.5}>Waiting for output...</Shimmer>
      ) : (
        <span className="text-zinc-600">No output</span>
      )}
    </div>
  )
}
