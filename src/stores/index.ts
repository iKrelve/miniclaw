/**
 * 小龙虾 (MiniClaw) — Zustand Store
 *
 * Central state management for the application.
 * Types imported from shared/types.ts — single source of truth.
 */

import { create } from 'zustand';
import type { ChatSession, Message } from '@shared/types';

interface AppStore {
  // Sidecar
  sidecarPort: number | null;
  sidecarReady: boolean;
  setSidecar: (port: number) => void;

  // Sessions
  sessions: ChatSession[];
  activeSessionId: string | null;
  setSessions: (sessions: ChatSession[]) => void;
  setActiveSession: (id: string | null) => void;
  addSession: (session: ChatSession) => void;
  removeSession: (id: string) => void;

  // Messages for active session
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;

  // UI
  theme: string;
  setTheme: (theme: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Settings
  settings: Record<string, string>;
  setSettings: (settings: Record<string, string>) => void;
  updateSetting: (key: string, value: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  // Sidecar
  sidecarPort: null,
  sidecarReady: false,
  setSidecar: (port) => set({ sidecarPort: port, sidecarReady: true }),

  // Sessions
  sessions: [],
  activeSessionId: null,
  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  addSession: (session) =>
    set((state) => ({ sessions: [session, ...state.sessions] })),
  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    })),

  // Messages
  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

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
}));
