/**
 * Theme application — applies theme colors as CSS variables on :root.
 */

import type { ThemeColors, ThemeDefinition } from './types'

/** Convert camelCase to kebab-case */
function toKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * Apply a theme's colors to the document as CSS custom properties.
 * Sets --background, --foreground, --card, etc. on :root.
 */
export function applyTheme(theme: ThemeDefinition, mode: 'light' | 'dark'): void {
  const colors: ThemeColors = mode === 'dark' ? theme.dark : theme.light
  const root = document.documentElement

  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--${toKebab(key)}`, value)
  }

  // Set data-theme for potential CSS selectors
  root.setAttribute('data-theme', theme.id)

  // Set dark/light mode class
  if (mode === 'dark') {
    root.classList.add('dark')
    root.classList.remove('light')
  } else {
    root.classList.add('light')
    root.classList.remove('dark')
  }
}

/**
 * Detect system color scheme preference.
 */
export function getSystemMode(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
