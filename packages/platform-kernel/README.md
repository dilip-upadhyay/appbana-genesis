# @appbana/platform-kernel

Coordinator for the AppBana Genesis runtime. Phase 1 Task 1 scope: **artifact resolution** — the kernel needs to know which CAM is currently serving traffic for a given `(appId, tenantId)`.

Satisfies **WS-1.4 Task 1** of the Phase 1 plan: "Kernel reads active-version pointer from the (Phase 1 in-process) Governance Registry; `/version` endpoint returns the loaded CAM's version."

## Public API

```ts
import {
  // Phase 1 in-process governance registry
  InMemoryGovernanceRegistry,

  // In-memory CAM cache — populated by resolveCam, enumerated by buildVersionInfo
  LoadedCamCache,

  // The resolver: (appId, tenantId) → LoadedCam
  resolveCam,
  refreshCam,

  // Pure function of registry state — the /version endpoint body
  buildVersionInfo,

  // Typed errors — one per failure mode
  NoActivePointerError,
  PointerHaltedError,
  CamNotFoundError,
  CamKindMismatchError,
  CamVersionMismatchError,
} from "@appbana/platform-kernel";
```

## Flow

```
+---------------------+     +----------------------+
| GovernanceRegistry  |     |  MetadataRegistry    |
| (Phase 1 in-proc)   |     |  (WS-1.3 Task 5)     |
+----------+----------+     +----------+-----------+
           |                           |
           v                           v
       ActiveVersionPointer      StoredArtifact
           \                           /
            \                         /
             +---> resolveCam(...) <-+
                       |
                       v
                   LoadedCam
                       |
                       v
                 LoadedCamCache
                       |
                       v
                buildVersionInfo(...) → GET /version
```

### `resolveCam(appId, tenantId, options)`

1. Read the active-version pointer via `governanceRegistry.getActive(appId, tenantId)`.
   - Throws `NoActivePointerError` if unset.
   - Throws `PointerHaltedError` if `pointer.kind === "halted"`.
2. Check the cache — hit-when-hash-matches short-circuits.
3. Fetch the CAM from the metadata registry by `pointer.camContentHash`.
   - Throws `CamNotFoundError` on absent hash.
   - Metadata Registry already recomputes the content hash on read (see `@appbana/metadata-registry`), so tamper detection is enforced upstream.
4. Verify `stored.artifactKind === "cam"` — throws `CamKindMismatchError` otherwise.
5. Verify `stored.version === pointer.camVersion` — throws `CamVersionMismatchError` otherwise (belt & suspenders against corrupted activations).
6. Cache the result and return.

### `buildVersionInfo({kernelVersion, platformVersion, deploymentMode, cache, loadedAdapters?, now?})`

Pure function of the cache. Returns the ADR-016 `/version` payload:

```json
{
  "kernelVersion": "0.1.0",
  "platformVersion": "0.1.0",
  "deploymentMode": "saas",
  "loadedCams": [
    {
      "appId": "app.customer-onboarding",
      "tenantId": "tenant.demo",
      "camId": "cam.customer-onboarding@1.0.0",
      "camVersion": "1.0.0",
      "camContentHash": "sha256:...",
      "gateReportId": "sha256:...",
      "loadedAt": "2026-07-25T00:00:02.000Z"
    }
  ],
  "loadedAdapters": [],
  "generatedAt": "2026-07-25T12:00:00.000Z"
}
```

Sort is `(appId ASC, tenantId ASC)` for byte-stable output. `loadedAdapters` is reserved for WS-1.4 Task 4 (effect descriptor dispatch); Phase 1 Task 1 callers pass `[]`.

## Governance Registry — Phase 1 scope

`InMemoryGovernanceRegistry` supports:

- `activate({appId, tenantId, camContentHash, camVersion, gateReportId, activatedBy})` — write / replace the pointer. Idempotent for identical inputs (stable `activatedAt`).
- `getActive(appId, tenantId)` — read.
- `listActive()` — enumerate for `/version`.

**Deferred to a later WS-1.4 task** (ADR-017): `rollback` (new pointer swap + fresh runtime-compatibility + rollback-readiness check re-run), `halt` (pointer swap to sentinel). The `ActiveVersionPointer.kind` discriminator is on the wire from day one so downstream code that consumes pointers already handles `halted` correctly (`PointerHaltedError`).

## Multi-tenancy

Pointers are stored per `(appId, tenantId)`. Two tenants of the same app can run different CAM versions simultaneously, which matches the SaaS mode invariant in ADR-016.

## Testing

```powershell
npm test
```

23 tests: governance-registry (8), resolver (10), version (4), integration against the shipped Customer Onboarding CAM (2).

## Deferred

- Postgres Governance Registry driver — mirror the `metadata-registry` pattern (`pg` optional peer dep, RLS INSERT+SELECT only, content-addressed pointer history).
- `rollback` / `halt` operations per ADR-017 with the required 2-check re-evaluation.
- Session lifecycle, event bus, effect dispatch, OTel propagation — WS-1.4 Tasks 2–5.
