// Session lifecycle coordinator.
//
// Composes `@appbana/platform-kernel`'s `resolveCam` (WS-1.4 Task 1) with an
// injected session store and trace sink to deliver the WS-1.4 Task 2
// acceptance criterion:
//
//   `startSession(appId, principal) → sessionId`; session state persisted;
//   graceful shutdown flushes trace events.
//
// Deliberately narrow scope. The full trace-event bus lands in WS-1.4 Task 3
// and effect dispatch in Task 4; both consume this package's `Session` shape
// and `SessionTraceEvent` shape unchanged.

import { randomUUID } from "node:crypto";

import type { JsonObject, MetadataRegistry } from "@appbana/metadata-registry";
import {
  resolveCam,
  type GovernanceRegistry,
  type LoadedCamCache,
} from "@appbana/platform-kernel";

import {
  InvalidPrincipalError,
  SessionAlreadyEndedError,
  SessionNotFoundError,
  type Principal,
  type Session,
  type SessionStore,
  type SessionTraceEvent,
  type StartSessionInput,
  type TraceEnvironment,
  type TraceSeverity,
  type TraceSink,
} from "./types.js";

export interface SessionLifecycleDeps {
  readonly store: SessionStore;
  readonly governanceRegistry: GovernanceRegistry;
  readonly metadataRegistry: MetadataRegistry;
  readonly camCache?: LoadedCamCache;
  readonly traceSink: TraceSink;
  readonly now?: () => Date;
  readonly sessionIdGenerator?: () => string;
  /** Must yield a UUID — the trace-event schema requires `format: uuid` on `id`. */
  readonly eventIdGenerator?: () => string;
  /** Must yield a UUID. Shared by every event in one session. */
  readonly correlationIdGenerator?: () => string;
  /** Must yield 32 lowercase hex chars (W3C trace-id). */
  readonly traceIdGenerator?: () => string;
  /** Must yield 16 lowercase hex chars (W3C span-id). One per emitted event. */
  readonly spanIdGenerator?: () => string;
  /** Recorded in `context.environment`. Defaults to `dev`. */
  readonly environment?: TraceEnvironment;
  /** Recorded in `producedBy.kernelVersion` when supplied. */
  readonly kernelVersion?: string;
}

/**
 * Builds the fallback session-id generator used when the caller injects none.
 *
 * Two properties matter here (ADR-013):
 *  - time comes from the *injected* clock, so a frozen clock produces stable
 *    ids and a test can assert on them;
 *  - the counter is scoped to the returned closure, so two `SessionLifecycle`
 *    instances never share mutable state.
 */
function createDefaultIdGenerator(now: () => Date): (prefix: string) => string {
  let counter = 0;
  return (prefix: string): string => {
    counter += 1;
    return `${prefix}-${now().getTime().toString(36)}-${counter.toString(36)}`;
  };
}

/** Lowercase hex string of `bytes` length, used for W3C trace and span ids. */
function randomHex(bytes: number): string {
  return randomUUID().replaceAll("-", "").slice(0, bytes * 2);
}

export class SessionLifecycle {
  private readonly store: SessionStore;
  private readonly governanceRegistry: GovernanceRegistry;
  private readonly metadataRegistry: MetadataRegistry;
  private readonly camCache: LoadedCamCache | undefined;
  private readonly traceSink: TraceSink;
  private readonly now: () => Date;
  private readonly nextSessionId: () => string;
  private readonly nextEventId: () => string;
  private readonly nextCorrelationId: () => string;
  private readonly nextTraceId: () => string;
  private readonly nextSpanId: () => string;
  private readonly environment: TraceEnvironment;
  private readonly kernelVersion: string | undefined;

  constructor(deps: SessionLifecycleDeps) {
    this.store = deps.store;
    this.governanceRegistry = deps.governanceRegistry;
    this.metadataRegistry = deps.metadataRegistry;
    this.camCache = deps.camCache;
    this.traceSink = deps.traceSink;
    this.now = deps.now ?? (() => new Date());
    const defaultId = createDefaultIdGenerator(this.now);
    this.nextSessionId = deps.sessionIdGenerator ?? (() => defaultId("session"));
    // Event, correlation and trace ids must satisfy the trace-event schema's
    // uuid / hex patterns, so the defaults are random rather than clock-derived.
    // Tests inject deterministic generators.
    this.nextEventId = deps.eventIdGenerator ?? (() => randomUUID());
    this.nextCorrelationId = deps.correlationIdGenerator ?? (() => randomUUID());
    this.nextTraceId = deps.traceIdGenerator ?? (() => randomHex(16));
    this.nextSpanId = deps.spanIdGenerator ?? (() => randomHex(8));
    this.environment = deps.environment ?? "dev";
    this.kernelVersion = deps.kernelVersion;
  }

  async startSession(input: StartSessionInput): Promise<Session> {
    validatePrincipal(input.principal);
    // Fail-closed: propagate any resolveCam error (NoActivePointer, halted,
    // CAM not found, kind or version mismatch). This means startSession has
    // the same fail-closed semantics as the resolver — no session can exist
    // without a passing gate + resolvable CAM.
    const resolveOpts = {
      governanceRegistry: this.governanceRegistry,
      metadataRegistry: this.metadataRegistry,
      now: this.now,
      ...(this.camCache ? { cache: this.camCache } : {}),
    };
    const loaded = await resolveCam(input.appId, input.tenantId, resolveOpts);

    const session: Session = {
      sessionId: this.nextSessionId(),
      appId: input.appId,
      tenantId: input.tenantId,
      principal: input.principal,
      camId: loaded.camId,
      camContentHash: loaded.camContentHash,
      camVersion: loaded.camVersion,
      status: "active",
      state: input.initialState ?? {},
      startedAt: this.now().toISOString(),
      traceId: this.nextTraceId(),
      correlationId: this.nextCorrelationId(),
    };
    await this.store.put(session);

    await this.emit(session, "event.session.started", "info", {
      principalId: input.principal.principalId,
      roleCount: input.principal.roles.length,
    });

    return session;
  }

  async getSession(sessionId: string): Promise<Session> {
    const s = await this.store.get(sessionId);
    if (!s) {
      throw new SessionNotFoundError(sessionId);
    }
    return s;
  }

  async updateSessionState(
    sessionId: string,
    patch: JsonObject,
  ): Promise<Session> {
    const current = await this.getSession(sessionId);
    if (current.status !== "active") {
      throw new SessionAlreadyEndedError(sessionId, current.status);
    }
    const updated: Session = {
      ...current,
      state: { ...current.state, ...patch },
    };
    await this.store.put(updated);
    await this.emit(updated, "event.session.state.updated", "debug", {
      patchKeys: Object.keys(patch).sort((a, b) => a.localeCompare(b)),
    });
    return updated;
  }

  async endSession(sessionId: string, reason?: string): Promise<Session> {
    return this.terminate(sessionId, "closed", reason, "event.session.ended");
  }

  async abortSession(sessionId: string, reason: string): Promise<Session> {
    return this.terminate(sessionId, "aborted", reason, "event.session.aborted");
  }

  /**
   * Aborts every still-active session with `reason` and returns the count.
   * Callers that own a `BufferedTraceSink` should await its `flushAll()` after
   * this returns to complete the graceful-shutdown-flushes-trace-events
   * contract.
   */
  async shutdown(reason = "shutdown"): Promise<number> {
    const active = await this.store.list({ status: "active" });
    for (const s of active) {
      await this.abortSession(s.sessionId, reason);
    }
    return active.length;
  }

  private async terminate(
    sessionId: string,
    nextStatus: "closed" | "aborted",
    reason: string | undefined,
    eventKindRef: string,
  ): Promise<Session> {
    const current = await this.getSession(sessionId);
    if (current.status !== "active") {
      throw new SessionAlreadyEndedError(sessionId, current.status);
    }
    const endedAt = this.now().toISOString();
    const durationMs =
      new Date(endedAt).getTime() - new Date(current.startedAt).getTime();
    const updated: Session = {
      ...current,
      status: nextStatus,
      endedAt,
      ...(reason !== undefined ? { endReason: reason } : {}),
    };
    await this.store.put(updated);
    await this.emit(updated, eventKindRef, nextStatus === "aborted" ? "warn" : "info", {
      status: nextStatus,
      durationMs,
      ...(reason !== undefined ? { reason } : {}),
    });
    return updated;
  }

  /**
   * Builds a trace event that conforms to `trace-event.v0.1.schema.json`.
   *
   * `sessionId` and `camContentHash` live under `attributes` rather than at the
   * top level because the schema sets `additionalProperties: false`. That is
   * also the correct home for them: `attributes` is the documented OpenTelemetry
   * export surface.
   */
  private async emit(
    session: Session,
    eventKindRef: string,
    severity: TraceSeverity,
    payload: JsonObject,
  ): Promise<void> {
    const roleId = session.principal.roles[0];
    const event: SessionTraceEvent = {
      traceEventVersion: "0.1",
      id: this.nextEventId(),
      eventKindRef,
      occurredAt: this.now().toISOString(),
      producedBy: {
        kind: "kernel",
        subsystem: "session",
        ...(this.kernelVersion !== undefined ? { kernelVersion: this.kernelVersion } : {}),
      },
      traceContext: {
        traceId: session.traceId,
        spanId: this.nextSpanId(),
      },
      correlation: {
        correlationId: session.correlationId,
        ...(roleId !== undefined
          ? { principal: { roleId, subjectId: null, authenticated: true } }
          : {}),
      },
      context: {
        appId: session.appId,
        camId: session.camId,
        camVersion: session.camVersion,
        tenantId: session.tenantId,
        environment: this.environment,
      },
      severity,
      payload,
      // Present-and-empty is required so consumers can tell "nothing redacted"
      // apart from "redaction never ran". This package emits no PII in payloads.
      redactions: [],
      attributes: {
        "appbana.session.id": session.sessionId,
        "appbana.cam.content_hash": session.camContentHash,
      },
    };
    await this.traceSink.emit(event);
  }
}

function validatePrincipal(p: Principal): void {
  if (typeof p.principalId !== "string" || p.principalId.length === 0) {
    throw new InvalidPrincipalError("principalId must be a non-empty string");
  }
  if (!Array.isArray(p.roles)) {
    throw new InvalidPrincipalError("roles must be an array");
  }
}
