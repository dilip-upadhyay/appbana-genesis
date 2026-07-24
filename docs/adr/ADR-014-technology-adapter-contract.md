# ADR-014: Technology Adapter Contract & Conformance

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Dilip
- **Consulted:** Runtime engines team (ADR-013), Operations team (Operation Contract v0.1), Deployment team (ADR-016 pending)

## Context and Problem Statement

The eight runtime engines defined by [ADR-013](ADR-013-runtime-engine-contract.md) are pure, deterministic functions of a CAM sub-model. They produce `EffectDescriptor[]` — declarative descriptions of the outside-world changes the CAM requires. **Something has to actually perform those effects** against a real database, real object store, real message bus, real HTTP endpoint, real notification channel, real state store.

Additionally, the UI Runtime produces render-tree descriptions that some **UI adapter** must actually paint into a browser DOM, a mobile view, or a Java Swing shell.

Without a stable contract for these "somethings", the platform's central claim — **business intent survives technology change** — cannot hold. If swapping PostgreSQL for DynamoDB, or React for Java Server Faces, or Kafka for RabbitMQ requires changing the CAM, the boundary between deterministic engines and I/O has leaked.

We call these boundary components **Technology Adapters**. This ADR fixes their interface, capability declaration, discovery, conformance testing, and multi-adapter selection.

## Decision Drivers

- Adapters are the **only** components in the platform allowed to perform I/O, hold external connections, or embed vendor SDKs. Runtime engines cannot; the kernel does not.
- Adapters must be **replaceable at runtime configuration time**, not at CAM authoring time. A CAM must not name a specific adapter — it names an **adapter kind** and a **binding string**.
- The kernel must be able to **refuse to load** a CAM whose declared `requiredCapabilities` are not satisfied by any registered adapter — at startup, not on first use.
- Adapters must be **conformance-tested** against a suite that any implementation (in-house or third-party) can run. Passing the suite is the only meaning of "certified" in AppBana Genesis.
- Adapter behaviour must be **observable and reproducible enough** to answer "why did this side effect happen?" via the Trace Viewer — even though adapters themselves are non-deterministic (they touch the outside world).
- The contract must work for **both cloud SaaS and air-gapped on-prem** deployments (ADR-016). No cloud-only assumptions.
- Adapters must be **hot-swappable** across CAM major versions — swapping a `data:postgres` adapter for a `data:sqlite` adapter must not require CAM changes.

## Considered Options

### Option A — No adapter layer; each engine embeds its own driver

Engines directly `import { Client } from "pg"` or fetch APIs. **Rejected.** Violates ADR-013 determinism; couples business intent to vendor SDKs; makes air-gapped deployment nearly impossible; breaks the platform's core replaceability claim.

### Option B — Loose "plugin" pattern per engine, per capability

Each engine defines its own plugin interface (e.g., `DataPlugin`, `NotificationPlugin`). **Rejected.** Interface drift is inevitable when eight engines each define their own plugin shape. No shared conformance suite. No cross-engine effect composition.

### Option C — Single `TechnologyAdapter<TEffect>` interface with declared capabilities *(chosen)*

One interface. Adapters declare which effect kinds and capability tags they satisfy. The kernel routes each `EffectDescriptor` to the adapter whose declared capabilities match the CAM's `requiredCapabilities`. Selection is by `adapter.kind` + `adapter.binding` at load time — never at runtime.

### Option D — Chained middleware pipeline (like Express/Koa)

Every effect flows through every registered adapter which may or may not act. **Rejected.** Non-deterministic; hard to trace; makes rollback impossible; incompatible with the ADR-017 governance gate that must know statically which adapter will handle each effect.

## Decision

We adopt **Option C**: a single `TechnologyAdapter` interface with declared capabilities, kernel-managed discovery, static binding resolution at CAM load, and a mandatory conformance suite per adapter kind.

### The Five Adapter Kinds

Exactly the five `adapter.kind` values from the CAM OperationModel schema and Operation Contract v0.1:

| Kind | Purpose | Reference adapters (Phase 1–5) |
|---|---|---|
| `internal` | Kernel-native side effects: state transitions, pure evaluations, guard checks. Handled by the kernel itself, not a pluggable adapter, but exposed via the same interface for uniformity. | `kernel:state-transition`, `kernel:pure-eval` |
| `data` | Persistence of entities defined in `DataModel`. | `data:postgres`, `data:sqlite`, `data:dynamodb` (future) |
| `integration` | Outbound HTTP, message bus, ERP connectors, third-party APIs. | `integration:http`, `integration:kafka`, `integration:mq` |
| `notification` | Email, SMS, push, in-app inbox. | `notification:smtp`, `notification:twilio`, `notification:webhook` |
| `storage` | Blob / object storage for documents, attachments, exports. | `storage:s3`, `storage:minio`, `storage:filesystem` |

New adapter kinds require an ADR amendment (patch bump of this ADR).

### The `TechnologyAdapter` Interface

Every adapter package exports one class per adapter identity that implements:

```ts
export interface TechnologyAdapter<
  TEffect extends EffectDescriptor = EffectDescriptor,
  TResult = unknown
> {
  /** Identity — kind + binding string used to match CAM OperationModel.adapter. */
  readonly kind: AdapterKind;                     // "data" | "storage" | "notification" | "integration" | "internal"
  readonly binding: string;                       // e.g. "data:postgres", "storage:s3"

  /** Static capability declaration. Read at kernel startup; never mutated. */
  readonly capabilities: AdapterCapabilities;

  /** Called once at kernel startup after config load. Establish pools, verify connectivity, warm caches. */
  init(config: AdapterConfig, ctx: AdapterInitContext): Promise<void>;

  /** Called on every effect the kernel routes to this adapter. */
  apply(
    effect: TEffect,
    ctx: AdapterInvocationContext
  ): Promise<AdapterResult<TResult>>;

  /** Optional compensation for effects the kernel has to roll back. Present iff capabilities.canCompensate === true. */
  compensate?(
    effect: TEffect,
    priorResult: AdapterResult<TResult>,
    ctx: AdapterInvocationContext
  ): Promise<AdapterResult<void>>;

  /** Called at graceful shutdown. Close pools, flush buffers. */
  shutdown(): Promise<void>;

  /** Health probe consumed by the platform readiness endpoint. */
  health(): Promise<AdapterHealth>;
}
```

`AdapterResult` is the same effect-report shape used by runtime engines, plus a bounded outcome payload:

```ts
export interface AdapterResult<T> {
  readonly outcome: "success" | "compensated" | "failed";
  readonly output?: T;
  readonly diagnostics: Diagnostic[];             // same shape as ADR-013 Diagnostic
  readonly traceEvents: TraceEvent[];             // MUST include at least one 'adapter.applied' event
  readonly correlationId: string;                 // echoed from the effect
  readonly reproducibilityHash?: string;          // sha256 of a canonicalized subset of adapter inputs; enables replay comparison
}
```

Failures are reported as `outcome: "failed"` with populated `diagnostics`. Adapters MUST NOT throw for expected failure modes (validation, guard failure, idempotency conflict, quota, connectivity). Exceptions are reserved for programmer errors.

### Capability Declaration

```ts
export interface AdapterCapabilities {
  readonly kind: AdapterKind;
  readonly binding: string;
  readonly supportedEffectTypes: readonly EffectType[];  // subset of the ADR-013 EffectDescriptor union
  readonly capabilities: readonly string[];              // free-form capability tags — matched against Operation Contract requiredCapabilities
  readonly canCompensate: boolean;                       // whether compensate() is implemented
  readonly transactional: "none" | "per-effect" | "cross-effect"; // strongest atomicity guarantee
  readonly streaming: boolean;                           // whether apply() may produce chunked output
  readonly maxPayloadBytes: number;                      // hard limit per apply() call
  readonly requiresNetwork: boolean;                     // MUST be false for air-gapped adapters
  readonly conformanceTier: "A" | "B" | "C";             // see next section
  readonly adapterVersion: string;                       // adapter semver, independent of platform version
  readonly minPlatformKernelVersion: string;
}
```

Capability tags are opaque strings. The catalog is grown by ADR-014 amendments. Phase 0 seed:

| Kind | Capability tags |
|---|---|
| `data` | `crud`, `atomic-persist`, `transactional-batch`, `optimistic-locking`, `soft-delete`, `full-text-search`, `time-travel`, `blob-fields` |
| `storage` | `put`, `get`, `list`, `delete`, `presigned-url`, `content-hash-idempotency`, `server-side-encryption`, `versioning` |
| `notification` | `send-email`, `send-sms`, `send-push`, `send-in-app`, `template-rendering`, `bulk-send` |
| `integration` | `http-request`, `http-webhook`, `message-publish`, `message-subscribe`, `retry`, `dead-letter` |
| `internal` | `state-transition`, `guard-evaluation`, `pure-eval`, `atomic-persist` |

### Conformance Tiers

Every adapter declares a tier reflecting the conformance suite it has passed:

- **Tier C — "Runnable"** — Passes basic apply/init/shutdown/health suite for its declared capabilities. Sufficient for local dev and demo.
- **Tier B — "Production-viable"** — Adds concurrency, idempotency-under-retry, and partial-failure conformance tests. Required for SaaS or dedicated-cloud deployments.
- **Tier A — "Regulated-workload"** — Adds durability (fsync/replicated commit), rollback via `compensate()`, audit-log integrity, and reproducibility-hash stability across restarts. Required for financial, healthcare, or air-gapped deployments.

The Governance Publication Gate (future ADR-017) will refuse to activate a CAM whose declared operational profile requires Tier A against an adapter that has only certified Tier B or C.

### Discovery and Binding

Adapters are packaged as `@appbana/adapter-<kind>-<name>` npm packages. Each package MUST export:

1. A `manifest.json` conforming to a to-be-published Adapter Manifest schema (Phase 1 deliverable). The manifest is the machine-readable form of `AdapterCapabilities`.
2. A default-exported class implementing `TechnologyAdapter`.

The kernel loads adapter packages listed in the deployment configuration (Helm values / Operator CR — see ADR-016). At load time:

1. Kernel reads all registered adapter manifests.
2. Kernel walks every `operation.adapter` in every loaded CAM.
3. For each `(kind, binding)` it selects the **unique** registered adapter with matching identity. Ambiguous matches → load fails.
4. For each selected adapter it verifies `requiredCapabilities ⊆ declaredCapabilities`. Missing → load fails.
5. Kernel then calls `adapter.init(config, ctx)` once per adapter. Init failures → load fails.

**A CAM can be blocked from activation at startup solely by adapter mismatch.** This is the intended behavior — better to fail-fast at deploy than at first user request.

### Reproducibility Without Determinism

Adapters are non-deterministic (they touch the outside world). But the platform must still answer "what happened, why, and could we do it again?" for the Trace Viewer and for compliance audits.

Every adapter's `apply()` MUST:

1. Emit at least one `TraceEvent` of kind `event.adapter.applied` with the effect id, correlation id, and adapter identity.
2. Compute a `reproducibilityHash` from a canonical subset of adapter-visible inputs (the effect descriptor after redaction, plus binding-specific config that would change behavior). This hash is stored on the trace event.
3. Redact PII / sensitive-pii fields from any payload written to trace events, per the CAM SecurityModel `dataClassifications` policy.

Two invocations with identical `reproducibilityHash` but different observed outcomes constitute an **adapter reproducibility incident** — flagged by the conformance suite at Tier A.

### Multi-Instance and Per-Tenant Selection

A single kernel process MAY host multiple adapters of the same kind with different bindings (e.g., `data:postgres` and `data:sqlite` co-existing during a migration). It MUST NOT host two adapters with the same `(kind, binding)` pair.

Per-tenant adapter selection is out of scope for v0.1. It becomes relevant when Phase 6 introduces true multi-tenancy — likely handled by a routing adapter of `kind: internal` that dispatches to tenant-specific downstream adapters.

### Conformance Suite Location

Every adapter package MUST include a `conformance/` directory mirroring the runtime-engine layout from ADR-013:

- `conformance/fixtures/` — effect descriptors covering the declared capabilities.
- `conformance/expectations.json` — expected outcome shape (not exact bytes; adapters are non-deterministic).
- `conformance/tier.json` — declared tier + which extended tests must pass.
- `conformance/conformance.test.ts` — imports the shared `@appbana/adapter-conformance-suite` runner and passes the fixtures.

Adapter CI must run the suite and fail the build on any regression. Third-party adapters that wish to publish a "Certified Tier X" badge must run the same suite and submit results.

## Consequences

### Positive

- The **hard boundary** between deterministic runtime engines and non-deterministic I/O is enforced by types, capability declarations, and load-time refusal — not by developer discipline.
- Swapping technology (Postgres → DynamoDB, SMTP → Twilio, React → Java UI) becomes a **deployment-time configuration change**, not a CAM change.
- Air-gapped deployments are a first-class scenario: any adapter with `requiresNetwork: true` is refused when the platform runs in `air-gapped` mode.
- ADR-017 has a clean predicate to enforce: "Adapter capabilities cover every operation contract's requiredCapabilities at the declared tier."
- Third parties can build and certify adapters without changing platform code.
- The Trace Viewer can answer "why did this side effect happen?" from the adapter trace events + reproducibility hash — closing the observability contract from ADR-013.

### Negative

- Every effect crosses one more indirection (kernel → adapter dispatch) versus a direct SDK call. Overhead is bounded to a hashmap lookup and one async call; measured cost <100µs per effect in a Phase 1 spike will be validated.
- Adapter authors must write conformance tests. This is a real cost, especially at Tier A, but the alternative (silent drift) is worse.
- Multiple registered adapters of the same kind must not overlap on `binding`; deployment configs must be explicit. Error messages at load must be actionable.

### Neutral

- The interface is TypeScript-first for v0.1. Java and Rust adapter authors will consume a language-native equivalent generated from a shared IDL in Phase 4/5 (target: match the JSON adapter manifest schema exactly).

## Follow-ups

- **Adapter Manifest v0.1 schema** — machine-readable form of `AdapterCapabilities`. Owned by the Adapter team; ships alongside the first reference adapter (`data:sqlite`) in Phase 1.
- **`@appbana/adapter-conformance-suite`** — shared test runner. Phase 1 with initial Tier C tests; Tier B in Phase 2; Tier A in Phase 4 (aligned with Java adapter arrival).
- **Reference adapters for Phase 1** — `data:sqlite`, `storage:filesystem`, `notification:log-only` (a dev-only adapter that writes notifications to the trace log). Sufficient to run Customer Onboarding end-to-end with zero cloud dependencies.
- **ADR-017 hook point** — governance gate reads `Adapter.capabilities.conformanceTier` and compares against `CAM.MetadataModel.tags.criticality` to enforce Tier A for high-criticality apps.

## References

- [ADR-011 — BIM vs AIM Boundary](ADR-011-bim-aim-boundary.md)
- [ADR-013 — Runtime Engine Contract](ADR-013-runtime-engine-contract.md)
- [Operation Contract v0.1 schema](../schemas/operation-contract.v0.1.schema.json)
- [CAM v0.1 schema — OperationModel.adapter](../schemas/cam.v0.1.schema.json)
- [architecture.md § 12 — Technology Adapter Layer](../../architecture.md)
- [architecture.md § 13 — Conformance Suite](../../architecture.md)
