/**
 * Shimmer — animated text loading indicator with sweeping gradient.
 */

import { type CSSProperties, memo, useMemo } from 'react'
import { motion } from 'motion/react'
import { cn } from '../../lib/utils'

// Pre-create the motion.p component at module level to avoid creating during render
const MotionP = motion.create('p')

export interface ShimmerProps {
  children: string
  className?: string
  duration?: number
  spread?: number
}

const ShimmerInner = ({ children, className, duration = 2, spread = 2 }: ShimmerProps) => {
  const dynamicSpread = useMemo(() => (children?.length ?? 0) * spread, [children, spread])

  return (
    <MotionP
      animate={{ backgroundPosition: '0% center' }}
      className={cn(
        'relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent',
        '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]',
        className,
      )}
      initial={{ backgroundPosition: '100% center' }}
      style={
        {
          '--spread': `${dynamicSpread}px`,
          backgroundImage:
            'var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))',
        } as CSSProperties
      }
      transition={{
        duration,
        ease: 'linear',
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </MotionP>
  )
}

export const Shimmer = memo(ShimmerInner)
