/**
 * 小龙虾 (MiniClaw) — Zustand Store
 *
 * Central state management for the application.
 * Types imported from shared/types.ts — single source of truth.
 */

import { create } from 'zustand'
import type { ChatSession } from '@shared/types'

interface AppStore {
  // Sidecar
  sidecarPort: number | null
  sidecarReady: boolean
  setSidecar: (port: number) => void

  // Sessions
  sessions: ChatSession[]
  activeSessionId: string | null
  setSessions: (sessions: ChatSession[]) => void
  /** Set active session and persist to localStorage for restore on restart */
  setActiveSession: (id: string | null) => void
  addSession: (session: ChatSession) => void
  removeSession: (id: string) => void
  updateSession: (id: string, updates: Partial<ChatSession>) => void

  // Working directory (last selected project path)
  workingDirectory: string
  setWorkingDirectory: (dir: string) => void

  // UI
  theme: string
  setTheme: (theme: string) => void
  sidebarOpen: boolean
  toggleSidebar: () => void

  // Settings
  settings: Record<string, string>
  setSettings: (settings: Record<string, string>) => void
  updateSetting: (key: string, value: string) => void
}

export const useAppStore = create<AppStore>((set) => ({
  // Sidecar
  sidecarPort: null,
  sidecarReady: false,
  setSidecar: (port) => set({ sidecarPort: port, sidecarReady: true }),

  // Sessions
  sessions: [],
  activeSessionId: localStorage.getItem('miniclaw:last-session-id') || null,
  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (id) => {
    if (id) {
      localStorage.setItem('miniclaw:last-session-id', id)
    } else {
      localStorage.removeItem('miniclaw:last-session-id')
    }
    set({ activeSessionId: id })
  },
  addSession: (session) => set((state) => ({ sessions: [session, ...state.sessions] })),
  removeSession: (id) =>
    set((state) => {
      const clearing = state.activeSessionId === id
      if (clearing) localStorage.removeItem('miniclaw:last-session-id')
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        activeSessionId: clearing ? null : state.activeSessionId,
      }
    }),
  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),

  // Working directory
  workingDirectory: localStorage.getItem('miniclaw:last-working-directory') || '',
  setWorkingDirectory: (dir) => set({ workingDirectory: dir }),

  // UI
  theme: 'default',
  setTheme: (theme) => set({ theme }),
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  // Settings
  settings: {},
  setSettings: (settings) => set({ settings }),
  updateSetting: (key, value) =>
    set((state) => ({ settings: { ...state.settings, [key]: value } })),
}))
