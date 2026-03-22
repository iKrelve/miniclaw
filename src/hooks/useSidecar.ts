/**
 * useSidecar — Manages connection to the Bun sidecar.
 * Gets the port from Tauri commands and provides a fetch helper.
 */

import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface SidecarState {
  port: number | null
  ready: boolean
  error: string | null
}

export function useSidecar() {
  const [state, setState] = useState<SidecarState>({
    port: null,
    ready: false,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    let retries = 0
    const maxRetries = 30

    async function pollPort() {
      while (!cancelled && retries < maxRetries) {
        try {
          const port = await invoke<number>('get_sidecar_port')
          if (!cancelled) {
            setState({ port, ready: true, error: null })
            return
          }
        } catch {
          retries++
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
      if (!cancelled) {
        setState({ port: null, ready: false, error: 'Sidecar failed to start' })
      }
    }

    // In dev mode, sidecar might be running directly
    const devPort = import.meta.env?.VITE_SIDECAR_PORT
    if (devPort) {
      setState({ port: Number(devPort), ready: true, error: null })
    } else {
      pollPort()
    }

    return () => {
      cancelled = true
    }
  }, [])

  const sidecarFetch = useCallback(
    async (path: string, options?: RequestInit): Promise<Response> => {
      if (!state.port) throw new Error('Sidecar not ready')
      const url = `http://127.0.0.1:${state.port}${path}`
      return fetch(url, options)
    },
    [state.port],
  )

  return {
    ...state,
    fetch: sidecarFetch,
    baseUrl: state.port ? `http://127.0.0.1:${state.port}` : null,
  }
}
