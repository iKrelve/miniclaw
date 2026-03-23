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

/** Auto-GC delay after stream completes (5 minutes) */
const GC_DELAY_MS = 5 * 60 * 1000

interface SessionBuffer {
  events: IndexedEvent[]
  listeners: Set<Listener>
  /** Whether the stream has finished (received a 'done' event) */
  done: boolean
  /** Timer handle for delayed GC after completion */
  gcTimer: ReturnType<typeof setTimeout> | null
  /**
   * Monotonically increasing generation counter. Incremented on each reset()
   * so SSE endpoints can distinguish "done from a previous conversation" from
   * "done from the current conversation".
   */
  generation: number
}

class EventBuffer {
  private buffers = new Map<string, SessionBuffer>()

  /** Push an event into a session's buffer and notify all subscribers */
  push(sessionId: string, type: string, data: unknown): void {
    const buf = this.ensure(sessionId)
    const event: IndexedEvent = { index: buf.events.length, type, data }
    buf.events.push(event)

    if (type === 'done') {
      buf.done = true
      this.scheduleGC(sessionId, buf)
    }

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

  /** Current generation of the session's buffer (0 if no buffer exists) */
  getGeneration(sessionId: string): number {
    return this.buffers.get(sessionId)?.generation ?? 0
  }

  /** Whether a buffer exists for this session (conversation in progress or recently finished) */
  has(sessionId: string): boolean {
    return this.buffers.has(sessionId)
  }

  /**
   * Reset a session's events without removing subscribers.
   * Used when a new conversation starts on the same session — existing SSE
   * subscribers stay connected and will receive the new events.
   */
  reset(sessionId: string): void {
    const buf = this.buffers.get(sessionId)
    if (buf) {
      if (buf.gcTimer) clearTimeout(buf.gcTimer)
      const oldCount = buf.events.length
      buf.events = []
      buf.done = false
      buf.gcTimer = null
      buf.generation++
      logger.debug('event-buffer', 'Reset buffer (listeners preserved)', {
        sessionId,
        oldEventCount: oldCount,
        listenerCount: buf.listeners.size,
        generation: buf.generation,
      })
    }
  }

  /** Clear a session's buffer entirely (events + listeners) */
  clear(sessionId: string): void {
    const buf = this.buffers.get(sessionId)
    if (buf) {
      if (buf.gcTimer) clearTimeout(buf.gcTimer)
      buf.listeners.clear()
      this.buffers.delete(sessionId)
      logger.debug('event-buffer', 'Cleared buffer', {
        sessionId,
        eventCount: buf.events.length,
      })
    }
  }

  /** Schedule automatic cleanup of a completed buffer after GC_DELAY_MS */
  private scheduleGC(sessionId: string, buf: SessionBuffer): void {
    if (buf.gcTimer) clearTimeout(buf.gcTimer)
    buf.gcTimer = setTimeout(() => {
      // Only GC if still the same buffer and still done (not restarted)
      const current = this.buffers.get(sessionId)
      if (current === buf && current.done) {
        current.listeners.clear()
        this.buffers.delete(sessionId)
        logger.debug('event-buffer', 'GC cleared completed buffer', {
          sessionId,
          eventCount: current.events.length,
        })
      }
    }, GC_DELAY_MS)
  }

  private ensure(sessionId: string): SessionBuffer {
    let buf = this.buffers.get(sessionId)
    if (!buf) {
      buf = { events: [], listeners: new Set(), done: false, gcTimer: null, generation: 0 }
      this.buffers.set(sessionId, buf)
    }
    return buf
  }
}

/** Singleton — survives across requests */
export const eventBuffer = new EventBuffer()
