// Effect union, diagnostic taxonomy, and JSON-purity tests.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DIAGNOSTIC_SEVERITIES,
  EFFECT_TYPES,
  canonicalJson,
  diagnosticViolation,
  effectViolation,
  hasError,
  isEffectDescriptor,
  isJson,
  jsonViolation,
} from "../dist/index.js";

const CORRELATION = "00000000-0000-4000-8000-000000000000";

describe("EffectDescriptor union", () => {
  it("locks the union to exactly six kinds", () => {
    // ADR-013: "adding new effect kinds is an ADR-worthy event". If this
    // assertion fails, the union was widened — confirm an ADR covers it.
    assert.deepEqual([...EFFECT_TYPES], [
      "persist",
      "emit",
      "notify",
      "transition",
      "dispatch-operation",
      "schedule",
    ]);
  });

  it("accepts every legal effect kind", () => {
    const legal = [
      { type: "persist", entity: "Applicant", operation: "upsert", data: { id: "1" }, correlationId: CORRELATION },
      { type: "emit", eventName: "applicant.created", payload: {}, correlationId: CORRELATION },
      { type: "notify", channel: "email", templateId: "t.welcome", recipients: ["a@b.c"], correlationId: CORRELATION },
      { type: "transition", stateMachineId: "sm.onboarding", entityRef: "Applicant/1", toState: "review", correlationId: CORRELATION },
      { type: "dispatch-operation", operationId: "op.score", input: {}, correlationId: CORRELATION },
      {
        type: "schedule",
        at: "2026-02-01T00:00:00.000Z",
        effect: { type: "emit", eventName: "reminder", payload: {} },
        correlationId: CORRELATION,
      },
    ];
    for (const effect of legal) {
      assert.equal(effectViolation(effect, "$"), undefined, `rejected ${effect.type}`);
      assert.equal(isEffectDescriptor(effect), true);
    }
  });

  it("rejects an ad-hoc effect kind", () => {
    const problem = effectViolation(
      { type: "send-email", correlationId: CORRELATION },
      "$",
    );
    assert.match(problem ?? "", /not in the closed EffectDescriptor union/);
    assert.match(problem ?? "", /requires an ADR/);
  });

  it("requires correlationId on every effect", () => {
    const problem = effectViolation({ type: "emit", eventName: "x", payload: {} }, "$");
    assert.match(problem ?? "", /correlationId/);
  });

  it("rejects a schedule nesting another schedule", () => {
    const problem = effectViolation(
      {
        type: "schedule",
        at: "2026-02-01T00:00:00.000Z",
        effect: { type: "schedule", at: "2026-03-01T00:00:00.000Z", effect: { type: "emit", eventName: "x", payload: {} } },
        correlationId: CORRELATION,
      },
      "$",
    );
    assert.match(problem ?? "", /may not itself be a "schedule"/);
  });

  it("rejects a nested schedule effect carrying its own correlationId", () => {
    const problem = effectViolation(
      {
        type: "schedule",
        at: "2026-02-01T00:00:00.000Z",
        effect: { type: "emit", eventName: "x", payload: {}, correlationId: CORRELATION },
        correlationId: CORRELATION,
      },
      "$",
    );
    assert.match(problem ?? "", /must omit correlationId/);
  });

  it("validates the nested effect of a schedule", () => {
    const problem = effectViolation(
      {
        type: "schedule",
        at: "2026-02-01T00:00:00.000Z",
        effect: { type: "notify", channel: "email", templateId: "t", recipients: "not-an-array" },
        correlationId: CORRELATION,
      },
      "$",
    );
    assert.match(problem ?? "", /recipients must be an array/);
  });

  it("rejects a non-ISO schedule instant", () => {
    const problem = effectViolation(
      { type: "schedule", at: "next tuesday", effect: { type: "emit", eventName: "x", payload: {} }, correlationId: CORRELATION },
      "$",
    );
    assert.match(problem ?? "", /ISO 8601/);
  });

  it("rejects a persist effect with an invalid operation", () => {
    const problem = effectViolation(
      { type: "persist", entity: "A", operation: "merge", data: {}, correlationId: CORRELATION },
      "$",
    );
    assert.match(problem ?? "", /"upsert" or "delete"/);
  });
});

describe("Diagnostic taxonomy", () => {
  it("exposes the severity ladder", () => {
    assert.deepEqual([...DIAGNOSTIC_SEVERITIES], ["info", "warning", "error"]);
  });

  it("accepts a well-formed diagnostic", () => {
    assert.equal(
      diagnosticViolation(
        { severity: "error", code: "rules.unknown-operator", message: "Unknown operator" },
        "$",
      ),
      undefined,
    );
  });

  it("rejects a free-form code so the Trace Viewer can group by prefix", () => {
    const problem = diagnosticViolation({ severity: "info", code: "Something Bad", message: "m" }, "$");
    assert.match(problem ?? "", /dotted lowercase identifier/);
  });

  it("rejects an unknown severity", () => {
    const problem = diagnosticViolation({ severity: "fatal", code: "a.b", message: "m" }, "$");
    assert.match(problem ?? "", /severity must be one of/);
  });

  it("detects fatal diagnostics", () => {
    assert.equal(hasError([{ severity: "warning", code: "a.b", message: "m" }]), false);
    assert.equal(hasError([{ severity: "error", code: "a.b", message: "m" }]), true);
  });
});

describe("JSON purity", () => {
  it("accepts plain JSON", () => {
    assert.equal(isJson({ a: [1, "two", true, null], b: { c: 3 } }), true);
  });

  it("names the exact path of a violation", () => {
    assert.equal(
      jsonViolation({ effects: [{ data: { createdAt: new Date() } }] }),
      "$.effects[0].data.createdAt is a Date instance, not a plain object",
    );
  });

  it("rejects NaN and Infinity, which JSON.stringify silently turns into null", () => {
    assert.match(jsonViolation({ x: Number.NaN }) ?? "", /is NaN/);
    assert.match(jsonViolation({ x: Number.POSITIVE_INFINITY }) ?? "", /is Infinity/);
  });

  it("rejects undefined, functions, symbols, and bigints", () => {
    assert.match(jsonViolation({ x: undefined }) ?? "", /is undefined/);
    assert.match(jsonViolation({ x: () => 1 }) ?? "", /is a function/);
    assert.match(jsonViolation({ x: Symbol("s") }) ?? "", /is a symbol/);
    assert.match(jsonViolation({ x: 1n }) ?? "", /is a bigint/);
  });

  it("detects circular references instead of overflowing the stack", () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;
    assert.match(jsonViolation(a) ?? "", /circular reference/);
  });

  it("rejects Map and Set, which serialise to {}", () => {
    assert.match(jsonViolation({ x: new Map() }) ?? "", /Map instance/);
    assert.match(jsonViolation({ x: new Set() }) ?? "", /Set instance/);
  });

  it("canonicalises key order at every depth but preserves array order", () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: 2, c: 3 } }),
      '{"a":{"c":3,"d":2},"b":1}',
    );
    assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  });
});
