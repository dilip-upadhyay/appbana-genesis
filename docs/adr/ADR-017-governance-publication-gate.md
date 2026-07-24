# ADR-017: Governance Publication Gate & Rollback

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Dilip
- **Consulted:** All prior ADR authors (011–016), Governance / Compliance, Security, Enterprise Sales, DevOps / SRE

## Context and Problem Statement

Every prior Phase 0 ADR points at this one:

- [ADR-011](ADR-011-bim-aim-boundary.md) established that AIM is the schema-conformant boundary crossing.
- [ADR-012](ADR-012-canonical-application-model-versioning.md) declared three hook points: version resolvability, major-bump migration coverage, major-bump reversibility.
- [ADR-013](ADR-013-runtime-engine-contract.md) required engines to declare kernel-version compatibility.
- [ADR-014](ADR-014-technology-adapter-contract.md) declared one hook point: technology-adapter conformance tier ≥ CAM criticality.
- [ADR-015](ADR-015-ai-model-adapter-layer.md) declared two hook points: AI-adapter tier ≥ criticality, and `humanReview.status` required when criticality demands.
- [ADR-016](ADR-016-deployment-packaging.md) declared the seventh: `deploymentMode` invariants (network, egress, telemetry, tenancy, registry, license) must hold before any `GenesisApplication` is admitted.

The [copilot-instructions.md](../../.github/copilot-instructions.md) locked-decisions section lists **10 mandatory checks** that must all pass before a CAM version activates in production. Without a single, load-bearing ADR that:

1. Enumerates those 10 checks as machine-readable gate predicates,
2. Fixes where each check runs, when it runs, and what artifact records the verdict,
3. Defines an immutable-artifact + active-version-pointer rollback protocol that never loses history,
4. States that no runtime engine, no adapter, no `/readyz` endpoint may consider a CAM active until the gate records `passed`,

the platform has no defensible answer to "how do you prevent an AI-generated change from silently reaching production?" That is the single question every regulated-vertical procurement team asks first.

This ADR closes the loop. It is the final Phase 0 architectural decision.

## Decision Drivers

- Enterprise applications require **SOX-grade audit and reversibility**. Every activation is a change event with a named human owner, a machine-readable verdict, and a rollback plan.
- **AI-generated patches must never bypass human approval** for anything the CAM's criticality label marks as high or regulated. Detection of AI provenance is done by looking at the AI provenance chain (ADR-015), not by heuristics.
- **Rollback must be atomic and near-instantaneous** — the active-version pointer swap is the only production-mutating operation. Data migrations that predated the swap must be reversible via the migration story declared in ADR-012.
- **Every gate check must produce a machine-readable report** — humans reviewing an activation want a diff, a rationale, and evidence, not a "trust me". The report is what auditors will subpoena.
- **The gate must run in-cluster in air-gapped mode**. No cloud service call may be part of the critical path (ADR-016 mode invariant).
- **The gate must fail closed**. Any check that cannot execute is treated as `blocked`, never as `passed`. Missing evidence is a fail.
- **A blocked activation must not disturb the currently-active version**. Rollback and roll-forward are symmetric operations against the immutable registry.
- **The 10 checks must be composable and independently versionable**. New checks arrive by ADR amendment; existing checks evolve via their own semver.

## Considered Options

### Option A — Ad-hoc CI checks per repository

Gate checks live as GitHub Actions jobs in the CAM authoring repo. **Rejected.** Not enforceable in-cluster; air-gapped installs have no GitHub; verdicts are not persisted to a queryable registry; a runtime that trusts CI cannot make its own admission decision.

### Option B — Single monolithic "gate service" that runs all 10 checks inline on the activation request

Simplest to reason about, but couples the checks: a single bug or a slow accessibility scan blocks fast schema validation. Also makes independent evolution of each check impossible. **Rejected.**

### Option C — Ten check plugins registered with a `GovernanceGate` coordinator that persists per-check verdicts, computes an overall verdict, and gates the active-version pointer swap *(chosen)*

Each check is an independent plugin with a stable interface (`GateCheck<TInput, TVerdict>`), its own semver, its own evidence store contract, and its own failure taxonomy. The `GovernanceGate` runs all 10 in parallel where possible, aggregates verdicts into a `GateReport`, persists the report into the immutable Governance Registry, and only then swaps the active-version pointer. The pointer swap is the sole production-mutating operation; rollback is a pointer swap in the opposite direction with the previous `GateReport` still on file.

## Decision

We adopt **Option C**: an in-cluster **Governance Publication Gate** composed of 10 independently-versioned check plugins, backed by an immutable Governance Registry, gating an atomic active-version-pointer swap.

### The Gate's Position in the Lifecycle

```
CAM authored → CAM validated (schema) → CAM staged into Registry → GovernanceGate.evaluate(cam, deployment, tenant)
                                                                       │
                                                                       ▼
                                                    GateReport {passed | blocked, checks[]}
                                                                       │
                                            ┌──────────────────────────┴──────────────────────────┐
                                        passed                                                blocked
                                            │                                                     │
                                Active-version pointer swap                     Report persisted; pointer unchanged
                                            │                                                     │
                                    /readyz returns 200                       /readyz keeps prior version's answer
```

The gate is invoked by the operator when a `GenesisApplication` CR is created or its `spec.camRef.version` changes. The operator does not touch the active-version pointer directly — only the `GovernanceGate` writes to it, and only after a `passed` verdict.

### The Ten Mandatory Checks

Each check is a `GateCheck` plugin with a stable identifier, semver, timeout, evidence contract, and failure taxonomy. All 10 are mandatory: their absence is `blocked`, not skipped. Any check that returns `blocked` blocks the overall verdict.

| # | Check id | Runs against | Blocks on |
|---|---|---|---|
| 1 | `check.schema-validation` | CAM envelope + every sub-model | Any Ajv validation failure against the version pinned in `envelopeVersion`. |
| 2 | `check.security-validation` | CAM SecurityModel + RoleModel + `dataClassifications` | ABAC rules that reference undefined roles; classification labels not defined in the tenant's policy; secrets referenced by literal value. |
| 3 | `check.privacy-validation` | CAM DataModel + SecurityModel + tenant's `tenantAIPolicy` | Any PII/sensitive-pii field lacking a redaction action; egress capability enabled to an adapter with `egressesInputsToThirdParty: true` when tenant forbids. |
| 4 | `check.accessibility-validation` | CAM InteractionUIModel | WCAG 2.2 AA violations detected by the accessibility linter (missing labels, insufficient contrast tokens, missing keyboard bindings). |
| 5 | `check.operation-contract-validation` | Every `operation.<id>:vN` referenced by the CAM | Missing Operation Contract in the registry; input/output schema mismatch vs. adapter capabilities; `errorTaxonomy` codes referenced by workflow guards not present in the contract. |
| 6 | `check.runtime-compatibility` | Every runtime engine required by the CAM | Engine version not compatible with the CAM's `envelopeVersion`; engine `minKernelVersion` > deployed kernel version; ADR-012 migration missing for a required major bump. |
| 7 | `check.adapter-capability-coverage` | Every `operation.adapter` in the CAM | Missing `GenesisAdapterBinding` for `(kind, binding)`; adapter's declared capabilities do not cover the operation contract's `requiredCapabilities`; adapter's `conformanceTier` < CAM's declared criticality tier. |
| 8 | `check.performance-budget` | CAM MetadataModel budgets + runtime baseline profile | Baseline performance replay shows any budget breach (p95 latency, memory, effect fan-out); no baseline available for a critical operation. |
| 9 | `check.ai-governance` | AI provenance chain for every AI-generated diff since prior activation | Missing AI provenance record; prompt template referenced but not present in the registry; `humanReview.status ≠ approved` when CAM criticality mandates human review; AI adapter `conformanceTier` < CAM criticality tier. |
| 10 | `check.rollback-readiness` | Prior active `GateReport` + this CAM's declared major-bump migrations | No prior `GateReport` on file (except for first-time activation, which is allowed); ADR-012 major-bump migration missing or declared non-reversible without a documented waiver. |

New checks require an ADR amendment (patch bump of this ADR). Removing a check is a **major** bump and requires a superseding ADR.

### The `GateCheck` Interface

```ts
export interface GateCheck<TInput = GateCheckInput, TVerdict = GateCheckVerdict> {
  readonly id: string;                                      // e.g. "check.schema-validation"
  readonly version: string;                                 // semver of this check plugin
  readonly timeoutMs: number;                               // hard cap; timeout = blocked
  readonly evidenceContract: EvidenceContract;              // JSON Schema describing the verdict evidence payload
  readonly failureTaxonomy: readonly string[];              // documented failure codes this check can emit

  evaluate(input: TInput, ctx: GateCheckContext): Promise<TVerdict>;
}

export interface GateCheckVerdict {
  readonly checkId: string;
  readonly checkVersion: string;
  readonly outcome: "passed" | "blocked" | "waived";
  readonly failureCode?: string;                            // MUST be present when outcome === "blocked"
  readonly evidence: unknown;                               // conforms to evidenceContract
  readonly diagnostics: Diagnostic[];                       // same Diagnostic shape as ADR-013
  readonly evaluatedAt: string;                             // ISO-8601 UTC
  readonly durationMs: number;
  readonly waiver?: GateWaiver;                             // present iff outcome === "waived"
}
```

Checks are pure functions of their input. They MAY read from the Governance Registry (prior verdicts, prior provenance), the CAM under evaluation, the deployment configuration, and the tenant policy. They MUST NOT read from the running application's data plane. They MUST NOT perform side effects other than writing their verdict to the Registry.

### The Aggregate `GateReport`

```ts
export interface GateReport {
  readonly gateReportVersion: "0.1";
  readonly id: string;                                      // UUID
  readonly camId: string;
  readonly camVersion: string;                              // semver
  readonly tenantId: string;
  readonly deploymentMode: "saas" | "dedicated-cloud" | "air-gapped";
  readonly evaluatedAt: string;                             // ISO-8601 UTC — evaluation start
  readonly completedAt: string;
  readonly overallOutcome: "passed" | "blocked";
  readonly verdicts: readonly GateCheckVerdict[];           // exactly 10 entries, one per mandatory check id
  readonly prevActiveReportId?: string;                     // links to the previously-active GateReport for this app+tenant
  readonly rollbackFromReportId?: string;                   // populated only when this report authorizes a rollback
  readonly signatures: readonly GateSignature[];            // cosign-style signatures over the canonicalized report bytes
}
```

**`overallOutcome === "passed"` iff every verdict is `passed` or `waived`, and no verdict is `blocked`.** Missing verdicts (fewer than 10) collapse to `blocked` regardless.

Reports are canonicalized (JCS — RFC 8785 — JSON Canonicalization) before signing so hashes are reproducible for the archival record.

### Waivers — Rare, Explicit, Time-Bounded

A verdict may be `waived` instead of `blocked` when a documented waiver applies. The waiver is a first-class artifact:

```ts
export interface GateWaiver {
  readonly waiverId: string;
  readonly checkId: string;
  readonly reason: string;                                  // free text; captured in audit
  readonly issuedBy: string;                                // opaque subjectId
  readonly issuedAt: string;
  readonly expiresAt: string;                               // MUST be ≤ 30 days from issuedAt for high/critical criticality
  readonly approverIds: readonly string[];                  // MUST be ≥ 2 for high/critical criticality
}
```

Waivers do not exist for `check.schema-validation` or `check.runtime-compatibility` — those are hard invariants. Attempting to waive them is a load-time error in the gate itself.

### The Immutable Governance Registry

- **Append-only.** No update or delete API is exposed. Persisted rows are content-addressed by the sha-256 of the canonicalized bytes.
- **Stores** every `GateReport`, every `GateCheckVerdict`, every prompt template hash referenced by any AI provenance record, every `GateWaiver`, and every active-version-pointer swap.
- **Queryable** by `(camId, tenantId, camVersion)` and by report id.
- **Retention** — for the lifetime of any CAM version whose activation ever pointed to a row. Rows are never garbage-collected while any active-version-pointer swap or provenance chain references them. This mirrors the prompt-template append-only-for-life rule from ADR-015.
- **Storage backend** — Postgres for SaaS / dedicated-cloud, embedded SQLite for air-gapped by default. Both back-ends must sync to durable storage before returning `written`.
- **In air-gapped mode** the Registry runs entirely in-cluster. There is no export to a cloud audit sink. Customers may configure an OTLP or filesystem export for their own SIEM.

### Active-Version Pointer & Atomic Swap

Every `(appId, tenantId)` pair has exactly one **active-version pointer** stored in the Registry:

```ts
export interface ActiveVersionPointer {
  readonly appId: string;
  readonly tenantId: string;
  readonly activeCamVersion: string;                        // semver
  readonly activeGateReportId: string;                      // UUID of the GateReport that authorised this activation
  readonly activatedAt: string;
  readonly activatedBy: string;                             // opaque subjectId of the person or automated process
  readonly previousPointer?: ActiveVersionPointer;          // links backward through history
}
```

The **swap** is a single atomic Registry write with two invariants:

1. The referenced `GateReport.overallOutcome` MUST be `passed`.
2. The referenced `GateReport.camVersion` MUST match `activeCamVersion`.

The kernel reads the pointer at startup and on Registry change notifications. **No runtime engine, no adapter, and no `/readyz` endpoint considers a CAM active until the pointer references it.** Traffic to a `GenesisApplication` whose pointer has not been set returns HTTP 503 with a diagnostic pointing to the last `blocked` `GateReport`.

### Rollback Protocol

Rollback is a **new pointer swap** to a prior `GateReport`, not a mutation of history:

1. Operator issues a rollback request for `(appId, tenantId)` to a prior `activeCamVersion` V.
2. Gate loads the historical `GateReport` for V. If `overallOutcome === "passed"`, the report remains valid.
3. Gate synthesises a **rollback report** referencing the historical report and running only two checks:
   - `check.runtime-compatibility` against the *current* deployed kernel and adapters (the versions may have moved since V was active).
   - `check.rollback-readiness` to verify reversibility of intervening data migrations.
4. If the rollback report passes, the pointer swaps to V with `rollbackFromReportId` populated. If it blocks, the swap does not happen and traffic stays on the current active version.

**No history is deleted or modified during rollback.** The provenance chain is complete: every activation, every rollback, every failed attempt is on file.

### Special Case — First-Time Activation

The first activation of a `(appId, tenantId)` has no prior `GateReport`. `check.rollback-readiness` MAY return `passed` with `evidence: {firstActivation: true}` in this case; all other checks run normally.

### Special Case — Emergency Halt

An operator MAY issue an **emergency halt** for `(appId, tenantId)` which is a pointer swap to a distinguished "halted" sentinel. Traffic returns 503 immediately. A halt is itself a Registry entry (subject to the same signing rules) — it does not delete the prior pointer, and rolling out of halt requires a fresh `GateReport` for whichever version the operator wants to bring back.

### Integration With Prior ADRs

- **ADR-012** — checks 6 and 10 consume the three ADR-012 hook points (version resolvability, migration coverage, reversibility). ADR-012 migrations are the required-evidence artifact for `check.rollback-readiness`.
- **ADR-013** — check 6 evaluates every engine's declared `minKernelVersion` and CAM-envelope compatibility. Diagnostics emitted by engines during a dry-run replay are attached as evidence.
- **ADR-014** — check 7 evaluates the technology-adapter capability coverage + tier hook point. Adapter manifests are the input; `GenesisAdapterBinding.status` is the substrate.
- **ADR-015** — check 9 evaluates the AI adapter tier + `humanReview.status` hook points. The AI Provenance Store is the input; the Registry stores a copy of the referenced provenance records for retention.
- **ADR-016** — check 6 additionally verifies deployment-mode invariants (`requiresNetwork`, `egressesInputsToThirdParty`, telemetry, tenancy, registry, license) as prerequisites for the operator's admission. The operator refuses to submit a CAM to the gate if these invariants are violated at the CR level; the gate itself re-verifies as a defense in depth.

### Public HTTP Surface

The gate exposes a small, stable HTTP API on the platform kernel:

- `POST /gate/evaluate` — kicks off a gate evaluation for a staged CAM. Async; returns a report id.
- `GET  /gate/reports/{id}` — retrieves a `GateReport`.
- `GET  /gate/pointers/{appId}/{tenantId}` — retrieves the active-version pointer + its history.
- `POST /gate/activate` — request to swap the active-version pointer to a `passed` report id. Idempotent by pointer id.
- `POST /gate/rollback` — request rollback to a prior report id.
- `POST /gate/halt` — request emergency halt.
- `POST /gate/waivers` — issue a waiver; requires the approver-count and expiry rules above.

Every endpoint requires an authenticated principal via the ADR-013 Security/Policy Runtime.

## Consequences

### Positive

- The 10 mandatory checks are now **enforced by the runtime**, not by developer discipline or CI hopefulness. Air-gapped and cloud deployments enforce identically.
- **Every activation and every rollback is a signed, canonicalized artifact** in an append-only registry — the exact substrate SOX / SOC 2 / PCI auditors expect.
- **AI-generated changes cannot bypass human approval** for CAMs whose criticality demands it — the AI provenance chain is a required input to `check.ai-governance`.
- **Rollback is boring**: swap the pointer, run two checks, done. No data plane mutation, no code redeploy, no ambiguity about what "rolling back" means.
- **The gate's failure mode is safe-by-design**: any missing evidence, timed-out check, or unavailable dependency is `blocked`, never `passed`. The currently-active version is undisturbed.
- The `check.*` plugin surface lets each check evolve independently (its own semver, its own team, its own eval framework) without churning the gate itself.
- Emergency halt gives operators a fast off-switch that is itself auditable — no more "someone SSH'd in and killed the pods".

### Negative

- Ten check plugins is real surface area. Each needs an owner, a test suite, a failure taxonomy, and a change-management story. This is intentional; there is no shortcut to defensible governance.
- The Governance Registry is a load-bearing dependency for every activation. Its availability and integrity become platform-level concerns (replication in SaaS, snapshot policy on-prem). Documented in the runbook alongside the kernel itself.
- Report canonicalization + signing on every activation is real CPU cost. Measured worst-case < 200 ms per report in a Phase 1 spike will be validated.
- Waivers are a controlled escape valve but a real risk vector. Enforcing the "no waivers on schema/runtime-compat" rule and the "expires ≤ 30 days for high criticality" rule at the gate code level (not in policy documents) is essential.

### Neutral

- The gate is invoked only at activation time, not on every runtime request. It is not on the hot path for user traffic. Its cost budget is measured in activations per day, not requests per second.
- Storage growth of the Registry is linear in activations + waivers + AI provenance records. For a mid-sized bank (~50 apps, ~5 activations/month/app, ~1000 AI calls/day), five-year retention fits comfortably in single-digit gigabytes on the on-prem SQLite backend.

## Follow-ups

- **`GateReport` v0.1 JSON Schema** — Phase 0.5 deliverable; publishes the canonical shape for third-party auditors.
- **`GateCheck` plugin conformance suite** — Phase 1; parallel in spirit to the ADR-014 / ADR-015 conformance suites but scoped to gate semantics (evidence schema conformance, failure-code stability, waiver rule enforcement).
- **Reference check implementations for Phase 1** — start with `check.schema-validation`, `check.operation-contract-validation`, `check.runtime-compatibility`, `check.adapter-capability-coverage`. The other six ship in Phases 2–4 aligned with when their underlying features exist to check.
- **Trace Event kinds** — add `event.gate.evaluated`, `event.gate.check-completed`, `event.gate.pointer-swapped`, `event.gate.rollback-issued`, `event.gate.halt-issued`, `event.gate.waiver-issued` to the Trace Event Kind Registry (Phase 1 deliverable per ADR-013 follow-ups).
- **Registry replication strategy** — Phase 2; multi-region async replication for SaaS; explicit backup/restore runbook for on-prem.
- **Auditor read-only exporter** — Phase 3; supplies signed report bundles to third-party auditors without granting Registry write access.

## References

- [ADR-011 — BIM vs AIM Boundary](ADR-011-bim-aim-boundary.md)
- [ADR-012 — CAM Versioning](ADR-012-canonical-application-model-versioning.md)
- [ADR-013 — Runtime Engine Contract](ADR-013-runtime-engine-contract.md)
- [ADR-014 — Technology Adapter Contract](ADR-014-technology-adapter-contract.md)
- [ADR-015 — AI Model Adapter Layer](ADR-015-ai-model-adapter-layer.md)
- [ADR-016 — Deployment Packaging (Kubernetes-first)](ADR-016-deployment-packaging.md)
- [Trace Event v0.1 schema](../schemas/trace-event.v0.1.schema.json)
- [copilot-instructions.md § Governance Publication Gate](../../.github/copilot-instructions.md)
- [architecture.md § 8 — Governance and Validation Plane](../../architecture.md)
- [architecture.md § 17 — AI Governance Architecture](../../architecture.md)
