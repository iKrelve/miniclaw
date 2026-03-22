/**
 * ChainOfThought — collapsible chain-of-thought steps display.
 * Adapted from CodePilot's ai-elements/chain-of-thought.tsx.
 */

import type { ComponentProps, ReactNode } from 'react'
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { Brain, CaretDown, DotOutline } from '@phosphor-icons/react'
import { createContext, memo, useContext, useMemo } from 'react'

interface ChainOfThoughtContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(null)

const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext)
  if (!context) {
    throw new Error('ChainOfThought components must be used within ChainOfThought')
  }
  return context
}

export type ChainOfThoughtProps = ComponentProps<typeof Collapsible> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export const ChainOfThought = memo(
  ({
    className,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: defaultOpen,
      onChange: onOpenChange,
      prop: open,
    })

    const contextValue = useMemo(
      () => ({ isOpen: isOpen ?? false, setIsOpen }),
      [isOpen, setIsOpen],
    )

    return (
      <ChainOfThoughtContext.Provider value={contextValue}>
        <Collapsible
          className={cn('not-prose mb-4', className)}
          open={isOpen}
          onOpenChange={setIsOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ChainOfThoughtContext.Provider>
    )
  },
)

export type ChainOfThoughtTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  stepsCount?: number
  label?: string
}

export const ChainOfThoughtTrigger = memo(
  ({
    className,
    children,
    stepsCount,
    label = '推理步骤',
    ...props
  }: ChainOfThoughtTriggerProps) => {
    const { isOpen } = useChainOfThought()

    return (
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground',
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <Brain className="size-4" />
            <span>{label}</span>
            {stepsCount !== undefined && (
              <Badge variant="secondary" className="text-[10px] px-1.5">
                {stepsCount}
              </Badge>
            )}
            <CaretDown
              className={cn(
                'size-4 transition-transform ml-auto',
                isOpen ? 'rotate-180' : 'rotate-0',
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    )
  },
)

export type ChainOfThoughtContentProps = ComponentProps<typeof CollapsibleContent>

export const ChainOfThoughtContent = ({ className, ...props }: ChainOfThoughtContentProps) => (
  <CollapsibleContent
    className={cn(
      'mt-2 space-y-1 text-sm',
      'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
      className,
    )}
    {...props}
  />
)

export type ChainOfThoughtStepProps = ComponentProps<'div'> & {
  label?: ReactNode
}

export const ChainOfThoughtStep = ({
  className,
  label,
  children,
  ...props
}: ChainOfThoughtStepProps) => (
  <div className={cn('flex items-start gap-2 text-muted-foreground text-xs', className)} {...props}>
    <DotOutline className="size-4 shrink-0 mt-0.5" />
    <div>
      {label && <span className="font-medium text-foreground">{label} </span>}
      {children}
    </div>
  </div>
)

ChainOfThought.displayName = 'ChainOfThought'
ChainOfThoughtTrigger.displayName = 'ChainOfThoughtTrigger'
