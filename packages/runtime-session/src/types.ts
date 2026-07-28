// @appbana/runtime-session — public types.
//
// WS-1.4 Task 2 scope: `startSession(appId, principal) → sessionId`; session
// state persisted; graceful shutdown flushes trace events.
//
// A Session is the kernel's per-user-per-app runtime context. It snapshots the
// active `camContentHash` at start so that a mid-session Governance-Gate
// activation of a new CAM version does NOT change the CAM the session sees —
// ADR-017 activation atomicity is preserved *for new sessions only*.
//
// The full trace-event bus + effect dispatch land in WS-1.4 Tasks 3–5. This
// package only emits `event.session.*` events into an injected TraceSink, so
// downstream consumers can wire it into whatever bus lands later without a
// re-write here.

import type { Json, JsonObject } from "@appbana/metadata-registry";

/**
 * Authenticated principal starting a session. Roles + attributes will be
 * consumed by the Security Runtime (WS-1.5) for ABAC; runtime-session itself
 * treats them opaquely and only enforces `principalId` presence.
 */
export interface Principal {
  readonly principalId: string;
  readonly roles: readonly string[];
  readonly attributes?: Readonly<Record<string, Json>>;
}

/** Session status. `closed` and `aborted` are terminal — no further state updates. */
export type SessionStatus = "active" | "closed" | "aborted";

/**
 * Persisted per-user-per-app runtime context. `camId`, `camContentHash` and
 * `camVersion` are snapshotted at start so version swaps mid-session do not
 * affect the session's semantics.
 */
export interface Session {
  readonly sessionId: string;
  readonly appId: string;
  readonly tenantId: string;
  readonly principal: Principal;
  /** `cam.<slug>` — required by the trace-event `context` object. */
  readonly camId: string;
  readonly camContentHash: string;
  readonly camVersion: string;
  readonly status: SessionStatus;
  readonly state: JsonObject;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly endReason?: string;
  /**
   * W3C trace-id for the whole session. Every trace event emitted for this
   * session shares it, so the Trace Viewer can reconstruct one session as a
   * single trace.
   */
  readonly traceId: string;
  /** Business-level correlation id shared by every event in this session. */
  readonly correlationId: string;
}

export interface StartSessionInput {
  readonly appId: string;
  readonly tenantId: string;
  readonly principal: Principal;
  readonly initialState?: JsonObject;
}

/**
 * Persistence contract for sessions. Phase 1 ships an in-memory driver; a
 * Postgres driver will mirror `@appbana/metadata-registry`'s pattern (pg
 * optional peer dep, RLS by tenant_id).
 */
export interface SessionStore {
  put(session: Session): Promise<void>;
  get(sessionId: string): Promise<Session | undefined>;
  list(filter?: SessionListFilter): Promise<readonly Session[]>;
}

export interface SessionListFilter {
  readonly appId?: string;
  readonly tenantId?: string;
  readonly principalId?: string;
  readonly status?: SessionStatus;
}

/**
 * A trace event emitted by this package.
 *
 * This type is a structural mirror of `docs/schemas/trace-event.v0.1.schema.json`
 * and is validated against that schema in `__tests__/trace-conformance.test.ts`.
 * The schema sets `additionalProperties: false`, so nothing may be added here
 * without a corresponding schema change.
 *
 * Note the deliberate omissions: `reproducibilityHash` is required only for
 * `producedBy.kind === "adapter"` events (ADR-014), and this package is a kernel
 * subsystem, so it never sets it.
 */
export interface SessionTraceEvent {
  readonly traceEventVersion: "0.1";
  /** Globally unique event id. Schema requires `format: uuid`. */
  readonly id: string;
  /** Schema pattern `^event\.[a-z][a-z0-9.-]*$`. */
  readonly eventKindRef: string;
  /** ISO-8601. Sourced from the injected clock, never the wall clock. */
  readonly occurredAt: string;
  readonly producedBy: {
    readonly kind: "kernel";
    readonly subsystem: "session";
    readonly kernelVersion?: string;
  };
  /** W3C Trace Context. Without this, OpenTelemetry propagation is impossible. */
  readonly traceContext: {
    /** 16-byte lowercase hex. */
    readonly traceId: string;
    /** 8-byte lowercase hex. */
    readonly spanId: string;
    readonly parentSpanId?: string | null;
  };
  readonly correlation: {
    readonly correlationId: string;
    readonly causationId?: string | null;
    readonly principal?: {
      readonly roleId: string;
      readonly subjectId?: string | null;
      readonly authenticated: boolean;
    } | null;
  };
  readonly context: {
    readonly appId: string;
    readonly camId: string;
    readonly camVersion: string;
    readonly tenantId?: string | null;
    readonly environment: TraceEnvironment;
    readonly region?: string;
  };
  readonly severity: TraceSeverity;
  readonly payload: JsonObject;
  /**
   * Present and possibly empty. The schema requires an empty array rather than
   * an absent one so consumers can distinguish "nothing redacted" from
   * "redaction never ran".
   */
  readonly redactions: readonly TraceRedaction[];
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export type TraceSeverity = "debug" | "info" | "warn" | "error";

export type TraceEnvironment = "dev" | "staging" | "canary" | "prod";

export interface TraceRedaction {
  /** JSON Pointer relative to `payload`. */
  readonly path: string;
  readonly classification: "public" | "internal" | "confidential" | "pii" | "sensitive-pii";
  readonly action: "removed" | "masked" | "hashed" | "truncated";
  readonly policyRef?: string;
}

/** W3C trace context supplied per emitted event. */
export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string | null;
}

/** Sink for trace events. The event bus lands in WS-1.4 Task 3; this package uses the sink. */
export interface TraceSink {
  emit(event: SessionTraceEvent): Promise<void> | void;
}

// Error taxonomy — stable codes. Fail-closed by construction.

export class SessionNotFoundError extends Error {
  readonly code = "SESSION_NOT_FOUND";
  constructor(readonly sessionId: string) {
    super(`No session with id ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionAlreadyEndedError extends Error {
  readonly code = "SESSION_ALREADY_ENDED";
  constructor(
    readonly sessionId: string,
    readonly currentStatus: SessionStatus,
  ) {
    super(
      `Session ${sessionId} is ${currentStatus} — cannot update or end again`,
    );
    this.name = "SessionAlreadyEndedError";
  }
}

export class InvalidPrincipalError extends Error {
  readonly code = "INVALID_PRINCIPAL";
  constructor(reason: string) {
    super(`Invalid principal: ${reason}`);
    this.name = "InvalidPrincipalError";
  }
}
