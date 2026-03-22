/**
 * SettingsCard — Rounded card container for settings sections.
 *
 * Mirrors CodePilot's SettingsCard pattern: border, padding, optional title/description.
 */

import { type ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface SettingsCardProps {
  title?: string
  description?: string
  children: ReactNode
  className?: string
}

export function SettingsCard({ title, description, children, className }: SettingsCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-4 transition-shadow hover:shadow-sm',
        className,
      )}
    >
      {(title || description) && (
        <div className="space-y-1">
          {title && <h3 className="text-sm font-medium">{title}</h3>}
          {description && <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
        </div>
      )}
      {children}
    </div>
  )
}
