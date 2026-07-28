// @appbana/engine-contract — the canonical TraceEvent type.
//
// This is the TypeScript face of docs/schemas/trace-event.v0.1.schema.json.
// The schema is the source of truth; this type mirrors it. The mirroring is
// not taken on trust — `__tests__/trace-event.test.ts` compiles the real
// schema with Ajv and validates fixtures of this type against it, so the two
// cannot drift silently.

import type { Json, JsonObject } from "./json.js";

/** The eight runtime engines, locked by ADR-013. */
export const ENGINE_IDS = [
  "runtime-interaction-ui",
  "runtime-workflow",
  "runtime-rules",
  "runtime-operations",
  "runtime-data",
  "runtime-integration",
  "runtime-security-policy",
  "runtime-observability",
] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

/**
 * The locked 1:1 engine → CAM sub-model ownership map (ADR-013).
 *
 * "No engine reads a sub-model outside its owned slot." Encoding this as data
 * lets the conformance suite reject an engine that declares the wrong slot,
 * and lets the kernel refuse to load two engines claiming the same sub-model.
 */
export const ENGINE_SUB_MODEL: Readonly<Record<EngineId, string>> = {
  "runtime-interaction-ui": "InteractionModel",
  "runtime-workflow": "WorkflowModel",
  "runtime-rules": "RuleModel",
  "runtime-operations": "OperationModel",
  "runtime-data": "DataModel",
  "runtime-integration": "IntegrationModel",
  "runtime-security-policy": "SecurityModel",
  "runtime-observability": "ObservabilityModel",
};

/**
 * The decisions each engine MUST emit a trace event for (ADR-013's trace
 * requirements table, verbatim).
 *
 * These are decisions, not event-kind ids. The concrete `event.*` ids come
 * from the Trace Event Kind Registry, which the trace-event schema itself
 * defers to Phase 1. Engines therefore declare a decision → eventKindRef map
 * in their capabilities, and the conformance suite verifies that every
 * mandated decision is both mapped and actually emitted across the fixture
 * set. This enforces completeness without inventing ids the platform has not
 * yet standardised.
 */
export const MANDATED_TRACE_DECISIONS: Readonly<Record<EngineId, readonly string[]>> = {
  "runtime-interaction-ui": ["field-rendered", "visibility-rule-fired"],
  "runtime-workflow": ["state-entered", "state-exited", "guard-evaluated", "task-assigned"],
  "runtime-rules": ["rule-evaluated", "derived-field-changed"],
  "runtime-operations": ["operation-dispatched", "adapter-selected", "result-received", "retry-attempted"],
  "runtime-data": ["entity-read", "entity-written", "query-executed", "migration-applied"],
  "runtime-integration": ["external-call-attempted", "adapter-selected", "response-envelope-hashed"],
  "runtime-security-policy": ["permission-checked", "abac-policy-evaluated"],
  "runtime-observability": ["aggregation-computed", "alert-threshold-crossed"],
};

export type TraceSeverity = "debug" | "info" | "warn" | "error";

export interface TraceContext {
  /** W3C trace-id, 32 lowercase hex chars. Propagated unchanged across engines. */
  readonly traceId: string;
  /** W3C span-id, 16 lowercase hex chars. */
  readonly spanId: string;
  readonly parentSpanId?: string | null;
}

export interface TracePrincipal {
  readonly roleId: string;
  /** Opaque, non-PII. Never a raw email or legal name. */
  readonly subjectId?: string | null;
  readonly authenticated: boolean;
}

export interface TraceCorrelation {
  readonly correlationId: string;
  /** id of the event that directly caused this one — chains form the causal DAG. */
  readonly causationId?: string | null;
  readonly principal?: TracePrincipal | null;
}

export interface TraceScope {
  readonly appId: string;
  readonly camId: string;
  readonly camVersion: string;
  readonly tenantId?: string | null;
  readonly environment: "dev" | "staging" | "canary" | "prod";
  readonly region?: string;
}

export type TraceProducer =
  | { readonly kind: "runtime-engine"; readonly engine: EngineId; readonly engineVersion?: string }
  | {
      readonly kind: "adapter";
      readonly adapterKind: "internal" | "data" | "integration" | "notification" | "storage";
      readonly binding: string;
      readonly adapterVersion?: string;
      readonly conformanceTier?: "A" | "B" | "C";
    }
  | {
      readonly kind: "kernel";
      readonly subsystem:
        | "loader"
        | "scheduler"
        | "registry"
        | "gate"
        | "effect-dispatch"
        | "provenance"
        | "session";
      readonly kernelVersion?: string;
    };

export interface TraceRedaction {
  /** JSON Pointer relative to `payload`. */
  readonly path: string;
  readonly classification: "public" | "internal" | "confidential" | "pii" | "sensitive-pii";
  readonly action: "removed" | "masked" | "hashed" | "truncated";
  readonly policyRef?: string;
}

export type TraceAttributeValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

/** The observability wire envelope. Mirrors trace-event.v0.1. */
export interface TraceEvent {
  readonly traceEventVersion: string;
  /** UUID. Produced by the emitter, never re-used. */
  readonly id: string;
  /** Must match a `traceEventKinds[].id` in the loaded CAM's ObservabilityModel. */
  readonly eventKindRef: string;
  /** ISO 8601. From the injected clock — never a wall-clock read inside an engine. */
  readonly occurredAt: string;
  readonly producedBy: TraceProducer;
  readonly traceContext: TraceContext;
  readonly correlation: TraceCorrelation;
  readonly context: TraceScope;
  readonly severity: TraceSeverity;
  readonly payload: JsonObject;
  /**
   * Empty array MUST be present when nothing was redacted, so consumers can
   * distinguish "none redacted" from "redaction never ran".
   */
  readonly redactions?: readonly TraceRedaction[];
  /** REQUIRED on adapter-produced events per ADR-014. */
  readonly reproducibilityHash?: string;
  readonly attributes?: Readonly<Record<string, TraceAttributeValue>>;
}

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
const EVENT_KIND = /^event\.[a-z][a-z0-9.-]*$/;

/**
 * Fast structural check used on the hot path by the conformance suite.
 *
 * This is deliberately *not* a replacement for Ajv validation against the real
 * schema — it is a cheap pre-filter that produces better messages for the
 * mistakes engine authors actually make. The authoritative check is
 * {@link createTraceEventValidator}.
 */
export function traceEventViolation(value: unknown, path: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `${path} is not an object`;
  }
  const e = value as Record<string, unknown>;

  if (typeof e["traceEventVersion"] !== "string") return `${path}.traceEventVersion is required`;
  if (typeof e["id"] !== "string" || e["id"] === "") return `${path}.id is required`;
  if (typeof e["eventKindRef"] !== "string" || !EVENT_KIND.test(e["eventKindRef"])) {
    return `${path}.eventKindRef must match ${EVENT_KIND.source}`;
  }
  if (typeof e["occurredAt"] !== "string" || Number.isNaN(Date.parse(e["occurredAt"]))) {
    return `${path}.occurredAt must be an ISO 8601 instant`;
  }
  if (typeof e["severity"] !== "string") return `${path}.severity is required`;
  if (typeof e["payload"] !== "object" || e["payload"] === null) return `${path}.payload must be an object`;

  const tc = e["traceContext"] as Record<string, unknown> | undefined;
  if (typeof tc !== "object" || tc === null) {
    return `${path}.traceContext is required — without W3C trace context, OpenTelemetry propagation is impossible`;
  }
  if (typeof tc["traceId"] !== "string" || !TRACE_ID.test(tc["traceId"])) {
    return `${path}.traceContext.traceId must be 32 lowercase hex characters`;
  }
  if (typeof tc["spanId"] !== "string" || !SPAN_ID.test(tc["spanId"])) {
    return `${path}.traceContext.spanId must be 16 lowercase hex characters`;
  }

  const corr = e["correlation"] as Record<string, unknown> | undefined;
  if (typeof corr !== "object" || corr === null || typeof corr["correlationId"] !== "string") {
    return `${path}.correlation.correlationId is required`;
  }

  const ctx = e["context"] as Record<string, unknown> | undefined;
  if (typeof ctx !== "object" || ctx === null) return `${path}.context is required`;
  for (const k of ["appId", "camId", "camVersion", "environment"]) {
    if (typeof ctx[k] !== "string" || ctx[k] === "") return `${path}.context.${k} is required`;
  }

  const producedBy = e["producedBy"] as Record<string, unknown> | undefined;
  if (typeof producedBy !== "object" || producedBy === null || typeof producedBy["kind"] !== "string") {
    return `${path}.producedBy.kind is required — the producer union is discriminated on it`;
  }
  if (producedBy["kind"] === "adapter" && typeof e["reproducibilityHash"] !== "string") {
    return `${path}.reproducibilityHash is required on adapter-produced events (ADR-014)`;
  }

  return undefined;
}

/** Narrow a Json payload to the trace payload type. */
export function asPayload(value: Record<string, Json>): JsonObject {
  return value;
}
