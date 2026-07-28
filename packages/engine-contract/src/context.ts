// @appbana/engine-contract — deterministic ExecutionContext construction.
//
// The determinism clause of ADR-013 is conditional: an engine is deterministic
// iff, given the same tuple "where `context.now` and `context.random` are
// seeded identically", execute returns byte-equivalent results. That clause is
// only testable if seeding is reproducible, so the contract package owns the
// seeding rather than leaving each engine's test suite to invent its own.

import type { EnginePrincipal, ExecutionContext, TraceLogger } from "./engine.js";
import type { Json } from "./json.js";
import type { TraceEvent } from "./trace-event.js";

/**
 * mulberry32 — a small, fast, fully deterministic PRNG.
 *
 * Chosen over any crypto source precisely because it is reproducible: the same
 * seed always yields the same sequence, in any process, on any machine. That
 * is the property the conformance suite depends on.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A clock that starts at `startIso` and advances by `stepMs` on every read.
 *
 * Advancing rather than freezing is deliberate: a frozen clock hides ordering
 * bugs (two events with identical timestamps look fine), while an advancing
 * clock is still perfectly reproducible but makes sequence visible in traces.
 */
export function steppedClock(startIso: string, stepMs = 1): () => string {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) {
    throw new TypeError(`steppedClock: "${startIso}" is not a parseable ISO 8601 instant`);
  }
  let tick = 0;
  return () => {
    const at = new Date(start + tick * stepMs).toISOString();
    tick += 1;
    return at;
  };
}

/** A `TraceLogger` that accumulates in memory. Performs no IO. */
export function recordingLogger(): TraceLogger & { readonly events: readonly TraceEvent[] } {
  const events: TraceEvent[] = [];
  return {
    events,
    trace(event: TraceEvent): void {
      events.push(event);
    },
  };
}

export interface ExecutionContextSeed {
  readonly appId?: string;
  readonly tenantId?: string;
  readonly sessionId?: string;
  readonly correlationId?: string;
  readonly principal?: EnginePrincipal;
  readonly startedAt?: string;
  readonly clockStepMs?: number;
  readonly randomSeed?: number;
  readonly featureFlags?: Readonly<Record<string, boolean>>;
}

const DEFAULT_PRINCIPAL: EnginePrincipal = {
  userId: "user.conformance",
  roleIds: ["role.applicant"],
  attributes: {} as Readonly<Record<string, Json>>,
};

/**
 * Builds a fully reproducible `ExecutionContext`.
 *
 * Two calls with the same seed produce contexts that are indistinguishable to
 * an engine — which is exactly what lets the conformance suite run an engine
 * twice and demand byte-identical output.
 */
export function createExecutionContext(
  seed: ExecutionContextSeed = {},
): ExecutionContext & { readonly logger: TraceLogger & { readonly events: readonly TraceEvent[] } } {
  return {
    appId: seed.appId ?? "app.conformance",
    tenantId: seed.tenantId ?? "tenant.conformance",
    sessionId: seed.sessionId ?? "session.conformance",
    correlationId: seed.correlationId ?? "00000000-0000-4000-8000-000000000000",
    principal: seed.principal ?? DEFAULT_PRINCIPAL,
    now: steppedClock(seed.startedAt ?? "2026-01-01T00:00:00.000Z", seed.clockStepMs ?? 1),
    random: seededRandom(seed.randomSeed ?? 0x5eed),
    featureFlags: seed.featureFlags ?? {},
    logger: recordingLogger(),
  };
}
