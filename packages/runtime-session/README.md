# @appbana/runtime-session

Session lifecycle for the AppBana Genesis kernel. Phase 1 **WS-1.4 Task 2**: `startSession(appId, principal) → sessionId`, session state persisted, graceful shutdown flushes trace events.

## Public API

```ts
import {
  // Coordinator
  SessionLifecycle,
  type SessionLifecycleDeps,

  // Session shape + statuses + errors
  type Session,
  type SessionStatus,
  type Principal,
  type StartSessionInput,
  SessionNotFoundError,
  SessionAlreadyEndedError,
  InvalidPrincipalError,

  // Storage
  InMemorySessionStore,
  type SessionStore,
  type SessionListFilter,

  // Trace plumbing
  type SessionTraceEvent,
  type TraceSink,
  BufferedTraceSink,
  ArrayTraceSink,
} from "@appbana/runtime-session";
```

## Flow

```
+---------------------+     +--------------------------+
|  GovernanceRegistry |     |     MetadataRegistry     |
|  (@appbana/platform-|     |   (@appbana/metadata-    |
|   kernel WS-1.4 T1) |     |    registry WS-1.3 T5)   |
+----------+----------+     +-------------+------------+
           \                              /
            \                            /
             \  resolveCam(appId, tenantId)
              \                          /
               v                        v
              SessionLifecycle.startSession(input)
                          |
                          v
                        Session (persisted via SessionStore)
                          |
                          v
                  event.session.started  --> TraceSink
                          |
                          v
                  updateSessionState / endSession / abortSession
                          |
                          v
              event.session.state.updated / .ended / .aborted
```

## Semantics

**`startSession(input)`** resolves the currently-active CAM via `resolveCam` before any state is written. This makes session creation inherit the platform-kernel's fail-closed error taxonomy (`NO_ACTIVE_POINTER`, `POINTER_HALTED`, `CAM_NOT_FOUND`, `CAM_KIND_MISMATCH`, `CAM_VERSION_MISMATCH`) — no session can exist without a passing Governance Gate + resolvable CAM. The resolved `camContentHash` + `camVersion` are snapshotted into the `Session`, so a subsequent activation of a *different* CAM does **not** change the running session's view. This preserves ADR-017 activation atomicity for existing sessions.

**`updateSessionState(sessionId, patch)`** merges `patch` over the existing `Session.state` and emits `event.session.state.updated` with only the **sorted key names** — never the values. Values may contain PII (e.g. `taxId`); Phase 1 rides through the redaction pipeline before values ever land in the wider event bus (WS-1.4 Task 3).

**`endSession(sessionId, reason?)`** transitions status to `closed`. `abortSession(sessionId, reason)` transitions status to `aborted`. Both are terminal — subsequent calls throw `SessionAlreadyEndedError` (code `SESSION_ALREADY_ENDED`). Both emit their respective lifecycle event with `durationMs`.

**`shutdown(reason)`** aborts every still-active session with `reason`. Callers that own a `BufferedTraceSink` should `await bufferedTraceSink.flushAll()` after shutdown returns — this is how the "graceful shutdown flushes trace events" acceptance criterion is satisfied end-to-end.

## Design invariants

- **Deterministic clock** — `now: () => Date` is injected; every timestamp on `Session` and `SessionTraceEvent` derives from it, so tests are byte-stable.
- **Deterministic id generation** — `sessionIdGenerator` and `eventIdGenerator` are injected; defaults use a lightweight counter suffixed by base-36 wall-clock ms for readable ids without pulling `crypto.randomUUID`.
- **Fail-closed** — every code path that reaches persistence has already validated the principal and resolved the CAM.
- **Tenant isolation at the store** — `SessionStore.list` filters by `tenantId` independent of `appId`, matching the ADR-017 `(appId, tenantId)` pointer boundary.
- **Trace events are envelope-shaped** — `SessionTraceEvent` carries `traceEventVersion: "0.1"`, `producedBy: { runtimeRole: "kernel", component: "runtime-session" }`, and the session's `camVersion` + `camContentHash`, matching the envelope invariants of `docs/schemas/trace-event.v0.1.schema.json`. The full kind registry lands in WS-1.4 Task 3.

## Emitted trace event kinds

| Kind | Payload |
|---|---|
| `event.session.started` | `{principalId: string, roleCount: number}` |
| `event.session.state.updated` | `{patchKeys: string[]}` — sorted, values never included |
| `event.session.ended` | `{status: "closed", durationMs: number, reason?: string}` |
| `event.session.aborted` | `{status: "aborted", durationMs: number, reason?: string}` |

## Testing

```powershell
npm test
```

26 tests: `store` (7), `trace-buffer` (4), `lifecycle` (13), `integration` (2).

## Deferred

- Postgres `SessionStore` driver — mirror `@appbana/metadata-registry` pattern: `pg` optional peer dep, RLS by `tenant_id`, indexed `(app_id, tenant_id, status)`.
- Full trace-event bus + kind registry + payload-schema validation — WS-1.4 Task 3.
- Effect descriptor dispatch — WS-1.4 Task 4.
- OTel `traceparent` propagation into `SessionTraceEvent.traceContext` — WS-1.4 Task 5.
- Session-owned redaction of `state` before values touch the wider event bus — belongs to WS-1.4 Task 3 + `@appbana/security-redaction` v0.2.
