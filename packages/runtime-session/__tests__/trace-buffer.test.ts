import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ArrayTraceSink,
  BufferedTraceSink,
  type SessionTraceEvent,
} from "../dist/index.js";

/**
 * Session id now travels in `attributes["appbana.session.id"]` rather than at
 * the envelope top level, because `trace-event.v0.1.schema.json` sets
 * `additionalProperties: false`. These helpers keep the tests readable.
 */
function makeEvent(
  id: string,
  sessionId = "session-1",
  overrides: Partial<SessionTraceEvent> = {},
): SessionTraceEvent {
  return {
    traceEventVersion: "0.1",
    id,
    eventKindRef: "event.session.started",
    occurredAt: "2026-07-25T00:00:00.000Z",
    producedBy: { kind: "kernel", subsystem: "session" },
    traceContext: { traceId: "a".repeat(32), spanId: "b".repeat(16) },
    correlation: { correlationId: "11111111-1111-4111-8111-111111111111" },
    context: {
      appId: "app.a",
      camId: "cam.a",
      camVersion: "1.0.0",
      tenantId: "tenant.alpha",
      environment: "dev",
    },
    severity: "info",
    payload: {},
    redactions: [],
    attributes: {
      "appbana.session.id": sessionId,
      "appbana.cam.content_hash": "sha256:aaa",
    },
    ...overrides,
  };
}

const sessionOf = (e: SessionTraceEvent): unknown => e.attributes?.["appbana.session.id"];

describe("BufferedTraceSink", () => {
  it("emit buffers per session; peek returns the pending events without flushing", () => {
    const downstream = new ArrayTraceSink();
    const buf = new BufferedTraceSink(downstream);
    buf.emit(makeEvent("e1"));
    buf.emit(makeEvent("e2"));
    assert.equal(buf.peek("session-1").length, 2);
    assert.equal(downstream.events.length, 0);
  });

  it("flush(sessionId) drains that session's buffer in insertion order and returns the count", async () => {
    const downstream = new ArrayTraceSink();
    const buf = new BufferedTraceSink(downstream);
    buf.emit(makeEvent("e1"));
    buf.emit(makeEvent("e2"));
    const flushed = await buf.flush("session-1");
    assert.equal(flushed, 2);
    assert.deepEqual(
      downstream.events.map((e) => e.id),
      ["e1", "e2"],
    );
    // second flush is a no-op
    assert.equal(await buf.flush("session-1"), 0);
  });

  it("flush is scoped to a single session — other sessions' buffers are untouched", async () => {
    const downstream = new ArrayTraceSink();
    const buf = new BufferedTraceSink(downstream);
    buf.emit(makeEvent("a", "s.a"));
    buf.emit(makeEvent("b", "s.b"));
    await buf.flush("s.a");
    assert.equal(downstream.events.length, 1);
    assert.equal(sessionOf(downstream.events[0] as SessionTraceEvent), "s.a");
    assert.equal(buf.peek("s.b").length, 1);
  });

  it("flushAll drains every session's buffer, iterating session ids in ASC order", async () => {
    const downstream = new ArrayTraceSink();
    const buf = new BufferedTraceSink(downstream);
    buf.emit(makeEvent("b1", "s.b"));
    buf.emit(makeEvent("a1", "s.a"));
    buf.emit(makeEvent("a2", "s.a"));
    const total = await buf.flushAll();
    assert.equal(total, 3);
    // s.a fully before s.b
    assert.deepEqual(
      downstream.events.map((e) => e.id),
      ["a1", "a2", "b1"],
    );
  });

  it("events without a session attribute are bucketed, not dropped", async () => {
    const downstream = new ArrayTraceSink();
    const buf = new BufferedTraceSink(downstream);
    const orphan = makeEvent("o1");
    buf.emit({ ...orphan, attributes: {} });
    assert.equal(await buf.flushAll(), 1, "an unattributed event must still flush");
    assert.equal(downstream.events[0]?.id, "o1");
  });
});
