# ADR-012: Canonical Application Model Versioning Strategy

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Dilip
- **Consulted:** Platform Kernel team, Migration Engine team, Runtime Engine leads, Governance team
- **Informed:** All Phase 0 – Phase 6 workstreams, adapter authors, on-premises release owners

## Context and Problem Statement

The Canonical Application Model (CAM) is the central execution artifact consumed by every runtime engine and technology adapter. As the platform evolves, sub-models will be added, fields renamed, enum values introduced, semantics tightened. Without a disciplined versioning strategy:

- Generated applications silently break on platform upgrades.
- Multi-tenant deployments cannot host apps at different maturity levels.
- Rollback becomes probabilistic instead of deterministic.
- The Governance Publication Gate (ADR-017) has no reliable input to reason about compatibility.
- Rust / Java / WASM engine ports have no stable target to certify against.

The AI translation pipeline defined in [ADR-011](ADR-011-bim-aim-boundary.md) and the engine contract in [ADR-013](ADR-013-runtime-engine-contract.md) both assume that CAM sub-models are individually versioned and independently upgradeable. This ADR makes that assumption explicit and defines the migration format.

## Decision Drivers

- **Business intent must survive technology change.** A CAM authored today must remain executable — via migration — for the life of the platform.
- **Independent engine evolution.** ADR-013 requires each engine to advertise `camSubModelVersionRange`. That requires per-sub-model semver, not monolithic.
- **Both scales.** Small banks may run three apps; large enterprises will run thousands, at many maturity levels simultaneously. The versioning scheme must not force a big-bang upgrade.
- **Governance-first.** Every version bump must be auditable. Migrations must be reviewable in a pull request without executing code.
- **Language portability.** Migrations must apply equally under the Node.js runtime and the Phase 4 Java adapter. TypeScript-only migrations are not acceptable as the primary path.
- **Rollback is a first-class operation.** Any deployment must be able to revert to the previous CAM without data loss, or explicitly document why not.
- **Compliance-critical enums are not the same as cosmetic enums.** The strictness of an enum-value addition must be a schema-author decision, not a blanket rule.

## Considered Options

1. **Monolithic CAM semver.** Single version at the top of the CAM. **Rejected.** Forces every engine to re-certify whenever any sub-model changes; contradicts ADR-013's independently-versioned engines; imposes an unnecessary lock-step on large enterprise deployments.
2. **Per-sub-model semver only, no envelope version.** **Rejected.** Leaves no place to describe the shape of the outer container itself; a change to how sub-models are wired together would have nowhere to record itself.
3. **Content-addressable artifacts with a migration graph and no semver.** **Rejected.** Fully general but hostile to humans; auditors and reviewers need a readable version number, not a hash.
4. **Envelope semver + per-sub-model semver, with declarative migrations and optional transformer code.** **Chosen.** Aligns with ADR-013's engine contract, keeps the format reviewable, supports independent evolution, and permits the language-portable migration path Phase 4 requires.

## Decision

Adopt **per-sub-model semver with a stable CAM envelope version**, standard JSON Schema evolution rules for breaking changes, opt-in strictness on enum additions, a **declarative-first migration format** with an optional pure transformer, and explicit hooks into the ADR-017 publication gate.

### Version Model

Every CAM instance carries this shape at the top:

```jsonc
{
  "envelopeVersion": "1.0",
  "metadata": { "camId": "...", "camReleaseTag": "onboarding@2026.07", "..." },
  "InteractionModel":   { "version": "0.1.0", "..." },
  "WorkflowModel":      { "version": "0.1.0", "..." },
  "RuleModel":          { "version": "0.1.0", "..." },
  "OperationModel":     { "version": "0.1.0", "..." },
  "DataModel":          { "version": "0.1.0", "..." },
  "IntegrationModel":   { "version": "0.1.0", "..." },
  "SecurityModel":      { "version": "0.1.0", "..." },
  "ObservabilityModel": { "version": "0.1.0", "..." },
  "DeploymentModel":    { "version": "0.1.0", "..." },
  "MetadataModel":      { "version": "0.1.0", "..." }
}
```

- **`envelopeVersion`** — semver `major.minor` describing only the outer container (how the file is structured, which sub-model slots exist). Starts at `1.0`. Bumps rarely; each bump is an ADR-worthy event.
- **`camReleaseTag`** — human-facing string (e.g., `onboarding@2026.07`) shown in the CLI and Governance UI. Not consumed by engines. Populated by the release pipeline.
- **Per-sub-model `version`** — semver `major.minor.patch`. Each sub-model evolves independently.

All sub-models start at `0.1.0` in Phase 0 and Phase 1. `1.0.0` sub-model versions are locked in with the Phase 2 exit criteria.

### Breaking-Change Rules

Standard JSON Schema evolution rules apply, with two Genesis-specific additions.

**Major bump required (breaking):**

- Field removal
- Field rename (treat as remove + add)
- Type change on an existing field
- Optional field made required; adding a new required field
- Enum **value** removal
- Tightening a constraint (e.g., `maxLength` reduced, new `pattern`, narrower numeric range)
- **Semantic change** to an existing field without a shape change (e.g., "priority: higher wins" → "higher loses"). Must reference an authorizing ADR.
- Change to the `EffectDescriptor` union defined in ADR-013 — the union is stable-by-design; any add/remove is major.
- Addition of a value to an enum where the schema declares `"closedStrictly": true` (see below).

**Minor bump (backward-compatible):**

- New optional field
- New sub-model slot added at the envelope level (requires an `envelopeVersion` minor bump too)
- Addition of a value to an enum where `"closedStrictly"` is `false` or absent
- Loosening a constraint (e.g., `maxLength` raised, `pattern` relaxed)
- Addition of an optional entry to a non-`EffectDescriptor` union that consumers can safely ignore
- Marking a required field optional

**Patch bump:**

- `title` / `description` clarifications
- Documentation-only changes
- Fixing regex patterns that were incorrectly rejecting valid values (record rationale in the changelog)

### The `closedStrictly` Enum Keyword

Every enum in the schema may opt into strict closure:

```jsonc
{
  "id": "enum.risk-band",
  "closedStrictly": true,
  "values": [
    { "value": "low",    "label": "Low" },
    { "value": "medium", "label": "Medium" },
    { "value": "high",   "label": "High" }
  ]
}
```

- Default is `false` (or absent). Adding a value is a **minor** bump.
- When `true`, adding a value is a **major** bump requiring a migration entry, full ADR-017 gate, and canary sign-off.
- Financial, regulatory, security-classification, workflow-status, and role enums SHOULD set `closedStrictly: true`. Cosmetic, taxonomy, and locale enums SHOULD leave it `false`.
- Consumers must implement `unknown-enum → Diagnostic(severity: warning)` on load — never throw. This applies whether `closedStrictly` is true or false.

The `closedStrictly` keyword is added to the AIM v0.1 and CAM v0.1 schemas as an optional annotation. Its presence is a governance signal, not a runtime validator input.

### Migration Format

Location: `packages/migration-engine/migrations/<SubModelName>__<from-version>__to__<to-version>/`

Each migration bundle contains:

```
migration.json          # ALWAYS required — the declarative source of truth
transform.ts            # OPTIONAL — pure function; required only for value-level transforms
transform.reverse.ts    # required iff migration.json declares "reversible": true
fixtures/before.json    # canonical old-version instance
fixtures/after.json     # expected new-version instance after migration
migration.test.ts       # runs transform against fixtures and asserts equality
```

**`migration.json` shape:**

```jsonc
{
  "subModel": "WorkflowModel",
  "fromVersion": "0.3.2",
  "toVersion": "1.0.0",
  "changeKind": "major",
  "authorizingAdr": "ADR-023",
  "authorizingCommit": "sha256:...",
  "structuralChanges": [
    { "op": "rename",       "path": "/states/*/timeout",         "newName": "timeoutMs" },
    { "op": "add",          "path": "/retention",                "required": true, "default": { "draftMaxAgeDays": 30 } },
    { "op": "remove",       "path": "/legacyEscalation",         "reason": "Superseded by escalationPolicy" },
    { "op": "changeType",   "path": "/priority",                 "fromType": "string", "toType": "integer" },
    { "op": "enumAdd",      "path": "/states/*/status",          "value": "on-hold" },
    { "op": "constraint",   "path": "/name",                     "change": "tighten", "detail": "maxLength 200 → 100" }
  ],
  "valueTransformer": "transform.ts",
  "reversible": true,
  "reverseTransformer": "transform.reverse.ts",
  "notes": "Timeout units changed from seconds to milliseconds; existing integer values are multiplied by 1000 in transform.ts."
}
```

**Migration rules:**

- `migration.json` alone is sufficient for pure structural changes (rename, add with default, remove, type change with an implicit coercion the migration engine understands).
- A `transform.ts` is required when a value-level transformation is needed (unit change, denormalization, currency rebase). Transformers obey the ADR-013 determinism contract: pure, no IO, injected `now` and `random`.
- Every migration ships `before.json`, `after.json`, and a passing `migration.test.ts`. CI enforces presence and green status.
- `reversible: true` requires a matching reverse transformer (or that the structural changes are trivially reversible). Enables the ADR-017 rollback gate.
- A migration whose `changeKind` is `patch` requires only the declarative descriptor and a rationale note; no transformer or fixtures are required.
- Migrations are portable: the declarative descriptor must apply identically in the Node.js runtime and (in Phase 4) the Java adapter. Transformers ported to Java must produce byte-identical output; a `migration.test.ts` counterpart in Java is required at that point.

### Deprecation Window

- Sub-model version `N-1` remains loadable for at least **one full minor release cycle** after `N` ships.
- Deprecated sub-model versions produce a `Diagnostic(severity: warning, code: "cam.subModel.deprecated")` on load, referencing the migration bundle that lifts them to `N`.
- After the deprecation window closes, loading the deprecated version produces a `Diagnostic(severity: error)` and the Platform Kernel refuses to execute the CAM until it is migrated.
- The publication of a tenant-specific CAM that pins a deprecated sub-model version requires an explicit override recorded in the audit trail.

### Interaction with ADR-017 (Governance Publication Gate)

The publication gate defined in ADR-017 gains three explicit inputs from this ADR:

- **Gate #1 (Schema validation)** — additionally verifies that every sub-model in the CAM declares a `version` that resolves to a published schema.
- **Gate #6 (Runtime compatibility validation)** — for every sub-model whose version bumped:
  - If the bump is **minor** or **patch**, no migration lookup is required.
  - If the bump is **major**, a valid migration entry MUST exist from every currently-deployed prior major version to the target version. Absent migration → gate fails.
- **Gate #10 (Human approval + rollback readiness)** — for any major bump:
  - Verify `reversible: true` on the migration entry, OR
  - Verify a compensating migration is authored and passes its own tests, OR
  - Record an explicit rollback waiver signed by the human approver, with reason, visible in the audit trail forever.

ADR-017 (currently a stub) will incorporate these hooks verbatim when it is written.

## Consequences

**Positive:**

- Engines can be replaced or upgraded independently — the small-bank Phase 1 deployment and the large-enterprise Phase 5 deployment operate under the same rules.
- The Governance UI can render a clean diff: which sub-models changed, at what change-kind level, backed by which migration.
- Auditors can review migrations in JSON — the declarative descriptor is the source of truth for governance.
- Language-portable migrations enable the Phase 4 Java adapter without a parallel migration codebase.
- Rollback discipline is enforced by CI + governance, not by convention.
- `closedStrictly` gives compliance-critical enums the ceremony they need without imposing it on cosmetic enums.

**Negative / Costs:**

- Ten sub-model version numbers to track. The CLI and Governance UI hide this behind `camReleaseTag` for humans, but tooling maintainers still see it.
- Every major bump on a sub-model requires a migration bundle with fixtures and tests — real authoring cost.
- Two migration surfaces (declarative + optional TS). Contributors must understand when TS is needed.
- The Migration Engine becomes a critical-path component. Its own correctness is under governance scrutiny.

**Neutral:**

- Requires the CAM v0.1 schema (WS-0.2, next) to include the `envelopeVersion`, per-sub-model `version` field, and `closedStrictly` enum keyword from day one.
- Requires the `packages/migration-engine/` package to be created in Phase 2 with an initial no-op migration to prove the format is executable.

## Compliance / Validation

- **Schema-level enforcement.** The CAM v0.1 JSON Schema requires `envelopeVersion` at the root and `version` on every sub-model. Missing version fields fail schema validation, which fails ADR-017 Gate #1.
- **Migration presence check in CI.** For every merged PR that bumps a sub-model major version, CI verifies the corresponding `migration.json` exists and its `migration.test.ts` passes.
- **Reversibility check in CI.** For every migration marked `reversible: true`, CI runs the forward and reverse transformers against the fixtures and asserts round-trip equality.
- **`closedStrictly` audit.** A CI job scans every schema and reports the list of enums marked `closedStrictly: true`. Any change to that list requires an explicit changelog entry.
- **Deprecation-window enforcement.** The Platform Kernel refuses to execute a CAM whose sub-model versions have exceeded the deprecation window unless an explicit override is present in the tenant configuration.
- **Reference example.** The Customer Onboarding CAM (once authored) must carry all ten sub-model versions and its `envelopeVersion`. The schema validator in `tools/validate-schemas/` enforces this.

## References

- [architecture.md § 9 — Canonical Application Model](../../architecture.md)
- [architecture.md § 13 — Migration Engine](../../architecture.md)
- [ADR-011 — BIM vs AIM Boundary](ADR-011-bim-aim-boundary.md)
- [ADR-013 — Runtime Engine Contract & Lifecycle](ADR-013-runtime-engine-contract.md)
- [ADR-017 — Governance Publication Gate (stub)](ADR-017-governance-publication-gate.md)
- [Schema Authoring Instructions](../../.github/instructions/schemas.instructions.md)
- [execution-plan.md — Phase 0 WS-0.1, WS-0.2 / Phase 2 Migration Engine / Phase 4 Java Adapter](../../execution-plan.md)
