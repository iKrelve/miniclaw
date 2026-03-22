/**
 * useTheme — Manages theme selection and persistence.
 */

import { useEffect } from 'react'
import { useAppStore } from '../stores'
import { getTheme, getDefaultTheme } from '../lib/theme/loader'
import { applyTheme, getSystemMode } from '../lib/theme/apply'

export function useTheme() {
  const { theme, setTheme } = useAppStore()

  // Apply theme on mount and when it changes
  useEffect(() => {
    const themeDef = getTheme(theme) || getDefaultTheme()
    const mode = getSystemMode()
    applyTheme(themeDef, mode)

    // Listen for system color scheme changes
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      const currentTheme = getTheme(theme) || getDefaultTheme()
      applyTheme(currentTheme, e.matches ? 'dark' : 'light')
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [theme])

  return { theme, setTheme }
}
