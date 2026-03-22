/**
 * Shimmer — animated text loading indicator with sweeping gradient.
 */

import type { CSSProperties } from 'react'
import { memo, useMemo } from 'react'
import { motion } from 'motion/react'
import { cn } from '../../lib/utils'

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
        '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),theme(colors.zinc.100),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]',
        'dark:[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),theme(colors.zinc.800),#0000_calc(50%+var(--spread)))]',
        className,
      )}
      initial={{ backgroundPosition: '100% center' }}
      style={
        {
          '--spread': `${dynamicSpread}px`,
          backgroundImage:
            'var(--bg), linear-gradient(theme(colors.zinc.400), theme(colors.zinc.400))',
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
