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
  readonly eventIdGenerator?: () => string;
}

let counter = 0;
function defaultId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
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

  constructor(deps: SessionLifecycleDeps) {
    this.store = deps.store;
    this.governanceRegistry = deps.governanceRegistry;
    this.metadataRegistry = deps.metadataRegistry;
    this.camCache = deps.camCache;
    this.traceSink = deps.traceSink;
    this.now = deps.now ?? (() => new Date());
    this.nextSessionId = deps.sessionIdGenerator ?? (() => defaultId("session"));
    this.nextEventId = deps.eventIdGenerator ?? (() => defaultId("evt"));
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
      camContentHash: loaded.camContentHash,
      camVersion: loaded.camVersion,
      status: "active",
      state: input.initialState ?? {},
      startedAt: this.now().toISOString(),
    };
    await this.store.put(session);

    await this.emit(session, "event.session.started", {
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
    await this.emit(updated, "event.session.state.updated", {
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
    eventKindId: string,
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
    await this.emit(updated, eventKindId, {
      status: nextStatus,
      durationMs,
      ...(reason !== undefined ? { reason } : {}),
    });
    return updated;
  }

  private async emit(
    session: Session,
    eventKindId: string,
    payload: JsonObject,
  ): Promise<void> {
    const event: SessionTraceEvent = {
      traceEventVersion: "0.1",
      eventId: this.nextEventId(),
      eventKindId,
      appId: session.appId,
      tenantId: session.tenantId,
      sessionId: session.sessionId,
      camVersion: session.camVersion,
      camContentHash: session.camContentHash,
      emittedAt: this.now().toISOString(),
      producedBy: { runtimeRole: "kernel", component: "runtime-session" },
      payload,
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
