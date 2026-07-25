// In-memory buffered `TraceSink`. Session-lifecycle events are appended into
// per-session buffers; `flush(sessionId)` drains the buffer into a downstream
// sink; `flushAll()` drains every buffer. This lets the lifecycle keep events
// "on the session" during its life and hand them off atomically at end /
// shutdown time — the graceful-shutdown-flushes-trace-events acceptance.

import type { SessionTraceEvent, TraceSink } from "./types.js";

export class BufferedTraceSink implements TraceSink {
  private readonly buffers = new Map<string, SessionTraceEvent[]>();

  constructor(private readonly downstream: TraceSink) {}

  emit(event: SessionTraceEvent): void {
    const existing = this.buffers.get(event.sessionId);
    if (existing) {
      existing.push(event);
      return;
    }
    this.buffers.set(event.sessionId, [event]);
  }

  /** Returns the events that were queued for the session. */
  peek(sessionId: string): readonly SessionTraceEvent[] {
    return this.buffers.get(sessionId) ?? [];
  }

  async flush(sessionId: string): Promise<number> {
    const events = this.buffers.get(sessionId);
    if (!events || events.length === 0) {
      this.buffers.delete(sessionId);
      return 0;
    }
    // Delete before iterating so a downstream re-entrant emit for this session
    // cannot double-flush.
    this.buffers.delete(sessionId);
    for (const event of events) {
      await this.downstream.emit(event);
    }
    return events.length;
  }

  async flushAll(): Promise<number> {
    // Snapshot the ids up-front so a concurrent emit during flush is ordered
    // consistently.
    const ids = [...this.buffers.keys()].sort((a, b) => a.localeCompare(b));
    let total = 0;
    for (const id of ids) {
      total += await this.flush(id);
    }
    return total;
  }
}

/** A `TraceSink` that appends events to a caller-supplied array. Testing helper. */
export class ArrayTraceSink implements TraceSink {
  readonly events: SessionTraceEvent[] = [];
  emit(event: SessionTraceEvent): void {
    this.events.push(event);
  }
}
