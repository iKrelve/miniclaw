/**
 * ThemeSelector — Grid of theme cards for selection.
 *
 * Wrapped in SettingsCard for consistency with the new layout.
 */

import { getThemes } from '../../lib/theme/loader'
import { useTheme } from '../../hooks/useTheme'
import { cn } from '../../lib/utils'
import { SettingsCard } from './SettingsCard'

export function ThemeSelector() {
  const { theme: activeTheme, setTheme } = useTheme()
  const themes = getThemes()

  return (
    <SettingsCard title="主题" description="选择你喜欢的配色方案">
      <div className="grid grid-cols-3 gap-3">
        {themes.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={cn(
              'relative rounded-xl p-3 text-left transition-all',
              'border-2',
              activeTheme === t.id
                ? 'border-blue-500 dark:border-blue-400 shadow-md'
                : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700',
            )}
          >
            {/* Color preview strip */}
            <div className="flex gap-1 mb-2">
              {[t.dark.background, t.dark.primary, t.dark.accent, t.dark.foreground].map(
                (color, i) => (
                  <div
                    key={i}
                    className="h-4 flex-1 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                ),
              )}
            </div>
            <div className="text-sm font-medium">{t.label}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
              {t.description}
            </div>
            {activeTheme === t.id && (
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-blue-500 dark:bg-blue-400 flex items-center justify-center">
                <span className="text-white text-xs">✓</span>
              </div>
            )}
          </button>
        ))}
      </div>
    </SettingsCard>
  )
}
