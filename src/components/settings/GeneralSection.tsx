/**
 * GeneralSection — General settings (theme, etc.)
 */

import { ThemeSelector } from './ThemeSelector'

export function GeneralSection() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-sm font-medium">通用</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">外观与基础偏好设置</p>
      </div>
      <ThemeSelector />
    </div>
  )
}
