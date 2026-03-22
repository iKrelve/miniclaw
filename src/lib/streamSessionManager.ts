/**
 * StreamSessionManager — singleton that manages SSE streams independently of component lifecycle.
 *
 * When a user switches sessions, the old ChatView unmounts but the stream
 * continues here. The new ChatView subscribes to get the current snapshot.
 */

import type { StreamMessage } from '../hooks/useSSEStream';

interface ActiveStream {
  sessionId: string;
  abortController: AbortController;
  text: string;
  events: StreamMessage[];
  streaming: boolean;
}

type Listener = (snapshot: StreamSnapshot) => void;

export interface StreamSnapshot {
  text: string;
  events: StreamMessage[];
  streaming: boolean;
}

class StreamSessionManager {
  private streams = new Map<string, ActiveStream>();
  private listeners = new Map<string, Set<Listener>>();

  /** Subscribe to a session's stream updates */
  subscribe(sessionId: string, listener: Listener): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(listener);

    // Immediately emit current snapshot if stream exists
    const stream = this.streams.get(sessionId);
    if (stream) {
      listener({ text: stream.text, events: stream.events, streaming: stream.streaming });
    }

    return () => {
      this.listeners.get(sessionId)?.delete(listener);
    };
  }

  /** Start a new SSE stream for a session */
  async startStream(
    baseUrl: string,
    sessionId: string,
    content: string,
    options?: { model?: string; mode?: string; providerId?: string },
  ) {
    // Abort existing stream for this session
    this.abortStream(sessionId);

    const abort = new AbortController();
    const stream: ActiveStream = {
      sessionId,
      abortController: abort,
      text: '',
      events: [],
      streaming: true,
    };
    this.streams.set(sessionId, stream);
    this.emit(sessionId);

    try {
      const res = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          content,
          model: options?.model,
          mode: options?.mode,
          provider_id: options?.providerId,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        stream.streaming = false;
        stream.events.push({ type: 'error', data: 'Request failed' });
        this.emit(sessionId);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as StreamMessage;
            if (event.type === 'text' && typeof event.data === 'string') {
              stream.text += event.data;
            } else if (event.type === 'done') {
              // stream complete
            } else {
              stream.events.push(event);
            }
            this.emit(sessionId);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        stream.events.push({ type: 'error', data: (err as Error).message });
      }
    } finally {
      stream.streaming = false;
      this.emit(sessionId);
    }
  }

  /** Abort a session's stream */
  abortStream(sessionId: string) {
    const stream = this.streams.get(sessionId);
    if (stream) {
      stream.abortController.abort();
      stream.streaming = false;
      this.emit(sessionId);
    }
  }

  /** Get current snapshot */
  getSnapshot(sessionId: string): StreamSnapshot | null {
    const stream = this.streams.get(sessionId);
    if (!stream) return null;
    return { text: stream.text, events: stream.events, streaming: stream.streaming };
  }

  /** Clear a session's stream data */
  clear(sessionId: string) {
    this.streams.delete(sessionId);
    this.emit(sessionId);
  }

  private emit(sessionId: string) {
    const stream = this.streams.get(sessionId);
    const snapshot: StreamSnapshot = stream
      ? { text: stream.text, events: stream.events, streaming: stream.streaming }
      : { text: '', events: [], streaming: false };
    this.listeners.get(sessionId)?.forEach((l) => l(snapshot));
  }
}

// Singleton — survives HMR via globalThis
const KEY = '__miniclaw_stream_manager__';
export const streamManager: StreamSessionManager =
  (globalThis as Record<string, unknown>)[KEY] as StreamSessionManager ??
  ((globalThis as Record<string, unknown>)[KEY] = new StreamSessionManager());