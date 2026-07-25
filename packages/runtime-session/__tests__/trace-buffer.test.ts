import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ArrayTraceSink,
  BufferedTraceSink,
  type SessionTraceEvent,
} from "../dist/index.js";

function makeEvent(overrides: Partial<SessionTraceEvent> = {}): SessionTraceEvent {
  return {
    traceEventVersion: "0.1",
    eventId: "evt-1",
    eventKindId: "event.session.started",
    appId: "app.a",
    tenantId: "tenant.alpha",
    sessionId: "session-1",
    camVersion: "1.0.0",
    camContentHash: "sha256:aaa",
    emittedAt: "2026-07-25T00:00:00.000Z",
    producedBy: { runtimeRole: "kernel", component: "runtime-session" },
    payload: {},
    ...overrides,
  };
}

describe("BufferedTraceSink", () => {
  it("emit buffers per session; peek returns the pending events without flushing", () => {
    const downstream = new ArrayTraceSink();
    const buf = new BufferedTraceSink(downstream);
    buf.emit(makeEvent({ eventId: "e1" }));
    buf.emit(makeEvent({ eventId: "e2" }));
    assert.equal(buf.peek("session-1").length, 2);
    assert.equal(downstream.events.length, 0);
  });

  it("flush(sessionId) drains that session's buffer in insertion order and returns the count", async () => {
    const downstream = new ArrayTraceSink();
    const buf = new BufferedTraceSink(downstream);
    buf.emit(makeEvent({ eventId: "e1" }));
    buf.emit(makeEvent({ eventId: "e2" }));
    const flushed = await buf.flush("session-1");
    assert.equal(flushed, 2);
    assert.deepEqual(
      downstream.events.map((e) => e.eventId),
      ["e1", "e2"],
    );
    // second flush is a no-op
    assert.equal(await buf.flush("session-1"), 0);
  });

  it("flush is scoped to a single session — other sessions' buffers are untouched", async () => {
    const downstream = new ArrayTraceSink();
    const buf = new BufferedTraceSink(downstream);
    buf.emit(makeEvent({ eventId: "a", sessionId: "s.a" }));
    buf.emit(makeEvent({ eventId: "b", sessionId: "s.b" }));
    await buf.flush("s.a");
    assert.equal(downstream.events.length, 1);
    assert.equal(downstream.events[0]?.sessionId, "s.a");
    assert.equal(buf.peek("s.b").length, 1);
  });

  it("flushAll drains every session's buffer, iterating session ids in ASC order", async () => {
    const downstream = new ArrayTraceSink();
    const buf = new BufferedTraceSink(downstream);
    buf.emit(makeEvent({ eventId: "b1", sessionId: "s.b" }));
    buf.emit(makeEvent({ eventId: "a1", sessionId: "s.a" }));
    buf.emit(makeEvent({ eventId: "a2", sessionId: "s.a" }));
    const total = await buf.flushAll();
    assert.equal(total, 3);
    // s.a fully before s.b
    const ids = downstream.events.map((e) => e.eventId);
    assert.deepEqual(ids, ["a1", "a2", "b1"]);
  });
});
