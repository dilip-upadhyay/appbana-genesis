// Trace event and deterministic-context tests.
//
// The point of this file is that the TypeScript `TraceEvent` type and the
// published JSON Schema agree. runtime-session previously carried a type that
// *claimed* to match the schema and violated 8 of its 10 required fields; the
// only defence against that recurring is validating real values against the
// real schema, which is what happens here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENGINE_IDS,
  ENGINE_SUB_MODEL,
  MANDATED_TRACE_DECISIONS,
  createExecutionContext,
  seededRandom,
  steppedClock,
  traceEventViolation,
} from "../dist/index.js";
import type { TraceEvent } from "../dist/index.js";
import { createTraceSchemaValidator } from "./fixtures.ts";

const validate = createTraceSchemaValidator();

function validEvent(): TraceEvent {
  return {
    traceEventVersion: "0.1",
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    eventKindRef: "event.rules.rule-evaluated",
    occurredAt: "2026-01-01T00:00:00.000Z",
    producedBy: { kind: "runtime-engine", engine: "runtime-rules", engineVersion: "0.1.0" },
    traceContext: {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    },
    correlation: { correlationId: "00000000-0000-4000-8000-000000000000" },
    context: {
      appId: "app.customer-onboarding",
      camId: "cam.customer-onboarding",
      camVersion: "1.0.0",
      environment: "dev",
    },
    severity: "info",
    payload: { ruleId: "rule.kyc-required", conditionResult: true },
    redactions: [],
  };
}

describe("TraceEvent ↔ trace-event.v0.1.schema.json", () => {
  it("a value of the exported type validates against the published schema", () => {
    assert.equal(validate(validEvent()), undefined);
  });

  it("negative control: the schema actually rejects a malformed event", () => {
    const broken = { ...validEvent(), traceContext: undefined };
    assert.notEqual(validate(broken), undefined);
  });

  it("requires W3C trace context, without which OTel propagation is impossible", () => {
    const { traceContext: _omitted, ...rest } = validEvent();
    assert.match(traceEventViolation(rest, "$") ?? "", /traceContext is required/);
    assert.notEqual(validate(rest), undefined);
  });

  it("rejects a malformed traceId", () => {
    const e = { ...validEvent(), traceContext: { traceId: "short", spanId: "00f067aa0ba902b7" } };
    assert.match(traceEventViolation(e, "$") ?? "", /32 lowercase hex/);
    assert.notEqual(validate(e), undefined);
  });

  it("requires reproducibilityHash on adapter-produced events (ADR-014)", () => {
    const e = {
      ...validEvent(),
      producedBy: { kind: "adapter", adapterKind: "data", binding: "postgres" },
    };
    assert.match(traceEventViolation(e, "$") ?? "", /reproducibilityHash/);
    assert.notEqual(validate(e), undefined);

    const withHash = { ...e, reproducibilityHash: `sha256:${"a".repeat(64)}` };
    assert.equal(traceEventViolation(withHash, "$"), undefined);
    assert.equal(validate(withHash), undefined);
  });

  it("rejects an eventKindRef outside the event.* namespace", () => {
    const e = { ...validEvent(), eventKindRef: "RuleEvaluated" };
    assert.match(traceEventViolation(e, "$") ?? "", /eventKindRef/);
    assert.notEqual(validate(e), undefined);
  });

  it("accepts the kernel producer variant used by runtime-session", () => {
    const e = { ...validEvent(), producedBy: { kind: "kernel", subsystem: "session" } };
    assert.equal(validate(e), undefined);
  });
});

describe("ADR-013 locked tables", () => {
  it("declares exactly eight engines", () => {
    assert.equal(ENGINE_IDS.length, 8);
  });

  it("maps every engine to exactly one CAM sub-model, with no duplicates", () => {
    const slots = ENGINE_IDS.map((id) => ENGINE_SUB_MODEL[id]);
    assert.equal(slots.length, 8);
    assert.equal(new Set(slots).size, 8, "two engines claim the same sub-model");
    for (const id of ENGINE_IDS) {
      assert.equal(typeof ENGINE_SUB_MODEL[id], "string");
    }
  });

  it("mandates at least one trace decision for every engine", () => {
    for (const id of ENGINE_IDS) {
      assert.ok(
        (MANDATED_TRACE_DECISIONS[id]?.length ?? 0) > 0,
        `${id} has no mandated trace decisions`,
      );
    }
  });
});

describe("deterministic ExecutionContext", () => {
  it("produces identical clock sequences for identical seeds", () => {
    const a = steppedClock("2026-01-01T00:00:00.000Z", 5);
    const b = steppedClock("2026-01-01T00:00:00.000Z", 5);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    assert.deepEqual(seqA, seqB);
    assert.deepEqual(seqA, [
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.005Z",
      "2026-01-01T00:00:00.010Z",
    ]);
  });

  it("advances rather than freezing, so event ordering stays visible", () => {
    const clock = steppedClock("2026-01-01T00:00:00.000Z", 1);
    assert.notEqual(clock(), clock());
  });

  it("rejects an unparseable start instant instead of silently yielding NaN", () => {
    assert.throws(() => steppedClock("not-a-date"), /not a parseable ISO 8601 instant/);
  });

  it("produces identical random sequences for identical seeds", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  });

  it("produces different sequences for different seeds", () => {
    assert.notEqual(seededRandom(1)(), seededRandom(2)());
  });

  it("yields values in [0, 1)", () => {
    const r = seededRandom(7);
    for (let i = 0; i < 500; i += 1) {
      const v = r();
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
  });

  it("builds two indistinguishable contexts from the same seed", () => {
    const a = createExecutionContext({ randomSeed: 9, startedAt: "2026-05-05T00:00:00.000Z" });
    const b = createExecutionContext({ randomSeed: 9, startedAt: "2026-05-05T00:00:00.000Z" });
    assert.equal(a.appId, b.appId);
    assert.deepEqual([a.now(), a.now()], [b.now(), b.now()]);
    assert.deepEqual([a.random(), a.random()], [b.random(), b.random()]);
  });

  it("accumulates logger events in memory without performing IO", () => {
    const ctx = createExecutionContext();
    ctx.logger.trace(validEvent());
    assert.equal(ctx.logger.events.length, 1);
  });
});
