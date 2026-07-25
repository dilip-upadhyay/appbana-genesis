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
 * Persisted per-user-per-app runtime context. `camContentHash` + `camVersion`
 * are snapshotted at start so version swaps mid-session do not affect the
 * session's semantics.
 */
export interface Session {
  readonly sessionId: string;
  readonly appId: string;
  readonly tenantId: string;
  readonly principal: Principal;
  readonly camContentHash: string;
  readonly camVersion: string;
  readonly status: SessionStatus;
  readonly state: JsonObject;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly endReason?: string;
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
 * The minimal trace-event shape emitted by this package. Aligns with the
 * envelope invariants of `docs/schemas/trace-event.v0.1.schema.json` but is
 * intentionally structural (not schema-loaded) — the full event bus + kind
 * registry land in WS-1.4 Task 3.
 */
export interface SessionTraceEvent {
  readonly traceEventVersion: "0.1";
  readonly eventId: string;
  readonly eventKindId: string;
  readonly appId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly camVersion: string;
  readonly camContentHash: string;
  readonly emittedAt: string;
  readonly producedBy: {
    readonly runtimeRole: "kernel";
    readonly component: "runtime-session";
  };
  readonly payload: JsonObject;
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
