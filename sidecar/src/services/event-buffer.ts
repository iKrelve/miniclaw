/**
 * Event Buffer — sidecar-side event accumulation for SSE streams.
 *
 * Each session has an ordered list of indexed events. Subscribers are
 * notified in real-time; latecomers can replay from any index via the
 * `after` cursor. This decouples "triggering a conversation" from
 * "consuming the event stream", so the WebView can disconnect/reconnect
 * without losing events.
 */

import { logger } from '../utils/logger'

export interface IndexedEvent {
  index: number
  type: string
  data: unknown
}

type Listener = (event: IndexedEvent) => void

interface SessionBuffer {
  events: IndexedEvent[]
  listeners: Set<Listener>
  /** Whether the stream has finished (received a 'done' event) */
  done: boolean
}

class EventBuffer {
  private buffers = new Map<string, SessionBuffer>()

  /** Push an event into a session's buffer and notify all subscribers */
  push(sessionId: string, type: string, data: unknown): void {
    const buf = this.ensure(sessionId)
    const event: IndexedEvent = { index: buf.events.length, type, data }
    buf.events.push(event)

    if (type === 'done') buf.done = true

    for (const listener of buf.listeners) {
      try {
        listener(event)
      } catch {
        // subscriber error — non-fatal
      }
    }
  }

  /**
   * Subscribe to a session's events.
   *
   * @param afterIndex — if provided, immediately replays all events with
   *   index > afterIndex before switching to live push mode.
   * @returns unsubscribe function
   */
  subscribe(sessionId: string, listener: Listener, afterIndex?: number): () => void {
    const buf = this.ensure(sessionId)

    // Replay missed events
    const start = afterIndex != null ? afterIndex + 1 : 0
    for (let i = start; i < buf.events.length; i++) {
      try {
        listener(buf.events[i])
      } catch {
        // replay error — non-fatal
      }
    }

    // Subscribe to future events
    buf.listeners.add(listener)

    return () => {
      buf.listeners.delete(listener)
    }
  }

  /** Whether the session's stream has completed */
  isDone(sessionId: string): boolean {
    return this.buffers.get(sessionId)?.done ?? false
  }

  /** Whether a buffer exists for this session (conversation in progress or recently finished) */
  has(sessionId: string): boolean {
    return this.buffers.has(sessionId)
  }

  /** Clear a session's buffer (call after the client has consumed all events) */
  clear(sessionId: string): void {
    const buf = this.buffers.get(sessionId)
    if (buf) {
      buf.listeners.clear()
      this.buffers.delete(sessionId)
      logger.debug('event-buffer', 'Cleared buffer', {
        sessionId,
        eventCount: buf.events.length,
      })
    }
  }

  private ensure(sessionId: string): SessionBuffer {
    let buf = this.buffers.get(sessionId)
    if (!buf) {
      buf = { events: [], listeners: new Set(), done: false }
      this.buffers.set(sessionId, buf)
    }
    return buf
  }
}

/** Singleton — survives across requests */
export const eventBuffer = new EventBuffer()
