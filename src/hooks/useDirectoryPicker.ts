/**
 * useDirectoryPicker — native folder picker via Tauri dialog,
 * with localStorage caching of last selected directory.
 */

import { useCallback } from 'react'
import { useAppStore } from '../stores'

const STORAGE_KEY = 'miniclaw:last-working-directory'

/** Check if running inside Tauri webview */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Open native folder picker (Tauri dialog).
 * Returns selected path or null if cancelled.
 */
async function openNativePicker(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<string | null>('select_directory')
    return result || null
  } catch {
    return null
  }
}

export function useDirectoryPicker() {
  const { workingDirectory, setWorkingDirectory } = useAppStore()

  /** Get the cached directory from localStorage */
  const getCachedDir = useCallback((): string | null => {
    return localStorage.getItem(STORAGE_KEY)
  }, [])

  /** Save directory to both store and localStorage */
  const saveDir = useCallback(
    (dir: string) => {
      setWorkingDirectory(dir)
      localStorage.setItem(STORAGE_KEY, dir)
    },
    [setWorkingDirectory],
  )

  /**
   * Pick a directory: try native dialog first, return the path.
   * Updates store + localStorage on success.
   */
  const pickDirectory = useCallback(async (): Promise<string | null> => {
    const path = await openNativePicker()
    if (path) {
      saveDir(path)
      return path
    }
    return null
  }, [saveDir])

  /**
   * Get the effective working directory:
   * 1. Current store value
   * 2. localStorage cache
   * 3. null (caller should prompt)
   */
  const getEffectiveDir = useCallback((): string | null => {
    if (workingDirectory) return workingDirectory
    const cached = getCachedDir()
    if (cached) {
      setWorkingDirectory(cached)
      return cached
    }
    return null
  }, [workingDirectory, getCachedDir, setWorkingDirectory])

  return {
    workingDirectory,
    pickDirectory,
    getEffectiveDir,
    saveDir,
    isTauri: isTauri(),
  }
}
