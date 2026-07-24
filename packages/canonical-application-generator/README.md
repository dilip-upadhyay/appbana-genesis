# @appbana/canonical-application-generator

**Purpose.** Deterministic AIM v0.1 → CAM v0.1 generator. Pure function of
(`AimDocument`, `GenerateCamOptions`). Identical input produces byte-identical
CAM output. Never uses AI, never reads the wall clock, never introspects the
environment.

Part of WS-1.3 (Task 3) of the Phase 1 delivery plan. See
[`docs/phase1/README.md`](../../docs/phase1/README.md).

## Contract

| Aspect | Behaviour |
|---|---|
| Input | `AimDocument` (as parsed from JSON) + `GenerateCamOptions` |
| Output | `GenerateCamResult` = `{ cam, diagnostics, camContentHash }` |
| Determinism | Given identical inputs (including `generatedAt`) → byte-identical `JSON.stringify(cam)` and identical `camContentHash` |
| Purity | No wall-clock reads, no `Math.random`, no environment access, no I/O |
| Schema conformance | Emitted CAM validates against [`docs/schemas/cam.v0.1.schema.json`](../../docs/schemas/cam.v0.1.schema.json) |
| Diagnostics | Every construct the generator drops or infers emits a structured `CamGeneratorDiagnostic` with a stable code |

## Public API

```ts
import { generateCam } from "@appbana/canonical-application-generator";

const { cam, diagnostics, camContentHash } = generateCam(aim, {
  generator: { name: "@appbana/canonical-application-generator", version: "0.1.0" },
  camId: "cam.customer-onboarding",
  camReleaseTag: "onboarding@2026.07",
  appId: "app.customer-onboarding",
  tenantId: null,
  environment: "dev",
  // INJECTED for determinism — the generator never reads the wall clock.
  generatedAt: "2026-07-25T00:00:00Z",
  aimContentHash: "sha256:...",
});
```

## Mapping table (AIM v0.1 → CAM v0.1)

### Envelope

| CAM slot | Source |
|---|---|
| `envelopeVersion` | `opts.envelopeVersion` (default `"1.0"`) |
| `metadata.camId` | `opts.camId` |
| `metadata.camReleaseTag` | `opts.camReleaseTag` |
| `metadata.appId` | `opts.appId` |
| `metadata.tenantId` | `opts.tenantId` |
| `metadata.environment` | `opts.environment` |
| `metadata.generatedAt` | `opts.generatedAt` (injected) |
| `metadata.sourceAim` | `{ id: aim.metadata.id, version: opts.aimVersion ?? aim.aimVersion, contentHash: opts.aimContentHash }` |
| `metadata.generator` | `opts.generator` verbatim |

### DataModel

| AIM entity/field key | CAM behaviour |
|---|---|
| `id`, `name`, `description`, `keys`, `fields` | passthrough |
| `sourceBusinessObject`, `note` | dropped |
| field `derivedFrom: "rule.x"` | rewritten to `derivedFromRuleRef: "rule.x"` |
| field `type: "enum", enumRef: null, allowedValues: [...]` | narrowed to `type: "string"` (drops `enumRef`); `allowedValues` retained |
| field `currency: "resolved-at-runtime"` | normalised to `"USD"` (v0.1 default) with an info diagnostic |
| field `visibility`, `requiredWhenStatusIn`, `sourceBimAttribute`, `note` | dropped from the field (visibility surfaces in SecurityModel) |

### WorkflowModel

| AIM state-machine construct | CAM behaviour |
|---|---|
| `id`, `entityRef`, `fieldRef`, `initialState`, `terminalStates`, `retention` | passthrough |
| state `sourceBimStage` | dropped |
| state-machine `sourceBimSection` | dropped |
| transition `guard: { ref: "rule.x" }` | rewritten to `guardRef: "rule.x"` |
| effect `{ type: "emit-trace", eventType: "case.x" }` | rewritten to `{ type: "emit-trace", eventKindRef: "event.case.x" }` (adds `event.` prefix if missing) |
| effect `{ type: "notify-applicant", template }` | rewritten to `{ type: "notify", template, recipients: ["role.applicant"] }` |
| effect `{ type: "assign-reviewer", policy: "round-robin" \| "workload-based" \| "manual" }` | passthrough |
| effect `{ type: "require-field", field }` | passthrough |
| effect `{ type: "create-customer-record" }` (or any other unrecognised type) | **dropped** with a `CAM_GEN_EFFECT_UNMAPPED` warning |

When any transition uses `assign-reviewer` with `policy: "round-robin"`, the
generator emits a default `assignmentPolicies` entry so the Workflow Runtime
has a policy binding to consume.

### RuleModel

| AIM rule construct | CAM behaviour |
|---|---|
| `id`, `description`, `priority` | passthrough (`description` defaults to `Rule <id>` when missing) |
| `kind` | passthrough if in {`field-requirement`, `field-constraint`, `field-visibility`, `document-requirement`, `derived-field`, `transition-guard`}; otherwise defaults to `field-requirement` with a `CAM_GEN_RULE_KIND_DEFAULT` warning |
| `sourceBimRuleId` | dropped; `sourceAimRuleId` is set to the AIM rule's own `id` |
| `when`, `condition` | expression AST canonicalised via `mapExpression` |
| `cases[].when` / `cases[].then` | expressions canonicalised; action `types` renamed to `documentTypes` |
| `target`, `targets` | passthrough (schema-typed as `{entity, field}`) |
| `kind: "field-visibility"` with root-level `allowRoles`/`denyRoles` | synthesised `when: { op: "always" }` + `then: [{ action: "set-visibility", visibility: { allowRoles, denyRoles } }]` |
| action `{ action: "require-documents", types: [...] }` | renamed to `documentTypes: [...]` |

### Rule expression shorthand (AIM) → CAM AST

| AIM shorthand | CAM AST |
|---|---|
| `{ always: true }` / `{ never: true }` | `{ op: "always" }` / `{ op: "never" }` |
| `{ all: [a, b, …] }` | `{ op: "and", operands: [...] }` |
| `{ any: [a, b, …] }` | `{ op: "or", operands: [...] }` |
| `{ and: [a] }` / `{ or: [a] }` | single-operand → unwrapped (info diagnostic `CAM_GEN_BOOLEAN_UNWRAPPED`) |
| `{ not: x }` | `{ op: "not", operand: <x> }` |
| `{ ref: "rule.x" }` | `{ op: "ref", ruleId: "rule.x" }` |
| `{ role-is: "role.x" }` | `{ op: "role-is", roleId: "role.x" }` |
| `{ in: [value, list] }` | `{ op: "in", value, list }` |
| `{ matches: [value, "regex"] }` | `{ op: "matches", value, pattern }` |
| `{ eq \| neq \| lt \| lte \| gt \| gte: [left, right] }` | `{ op, left, right }` |
| Operand string that looks like `entity.<x>.<field>` | `{ path: "..." }` |
| Other operand values | `{ literal: <value> }` |
| Explicit `{ op: "<custom>" }` (e.g. `all-required-fields-set`) | falls back to `{ op: "always" }` with a `CAM_GEN_EXPR_UNMAPPED` warning; the operator sees the diagnostic and knows to hand-author or extend the runtime |
| Any other shape | `{ op: "always" }` fallback with `CAM_GEN_EXPR_UNMAPPED` warning |

### OperationModel

Passthrough fields: `id`, `version`, `allowedRoles`, `idempotency`,
`retryPolicy`, `sideEffects`, `auditEvent`, `errorTaxonomy`.
`guard: {ref}` rewrites to `guardRef`. `sourceBimAction` is dropped.

Adapter inference (deterministic; first match wins, always emits a
`CAM_GEN_ADAPTER_INFERRED` info diagnostic):

| sideEffects contains | idempotency | Adapter |
|---|---|---|
| `object-store:put` | any | `{ kind: "storage", binding: "object-store:default" }` |
| `notify` | any | `{ kind: "notification", binding: "notification:default" }` |
| any `transition:*` | any | `{ kind: "internal", binding: "kernel:state-transition" }` |
| `persist` (and nothing above) | any | `{ kind: "data", binding: "<first entity id>" }` |
| `[]` (empty) | `pure` | `{ kind: "internal", binding: "kernel:pure-eval" }` |
| otherwise | any | `{ kind: "internal", binding: "kernel:generic" }` |

### SecurityModel

- `roles`: AIM roles stripped down to `roleDef` (drops `sourcePersonaName`,
  `approvalAuthority`).
- `fieldAbacPolicies`: one entry per entity field with a `visibility` block,
  plus one entry per AIM rule of kind `field-visibility`. The rule-derived
  entry sets `conditionRef` to the AIM rule id so the runtime can retrieve
  the rule's condition (if any).
- `dataClassifications`: one policy per distinct classification observed on
  fields (guaranteed to include at least `internal`). Defaults per class:

  | Class | maskInLogs | maskInUi | encryptionAtRest | encryptionInTransit |
  |---|---|---|---|---|
  | `public` | false | none | none | TLS-1.2+ |
  | `internal` | false | none | AES-256 | TLS-1.2+ |
  | `confidential` | true | none | AES-256 | TLS-1.2+ |
  | `pii` | true | last4-only | AES-256 | TLS-1.2+ |
  | `sensitive-pii` | true | full-mask | AES-256 | TLS-1.3 |

### InteractionModel

One `screen` per AIM role (preserving AIM order). Each screen has one
`section` per AIM entity (preserving AIM order), each section has one
`fieldBinding` per entity field (preserving order, with `order = index * 10`
to leave insertion room).

Ids:
- `screen.<role-slug>`
- `section.<role-slug>.<entity-slug>`
- `field-binding.<role-slug>.<entity-slug>.<field-slug>` (field-slug is the
  field id kebab-cased so it matches the schema pattern)

Control inference from `field.type` (+ optional `format`):

| AIM type | Format | CAM control |
|---|---|---|
| `string` | `email` | `email` |
| `string` | `phone*` | `phone` |
| `string` | — | `text` |
| `text` | — | `textarea` |
| `integer` / `decimal` | — | `number` |
| `money` | — | `money` |
| `boolean` | — | `boolean` |
| `date` | — | `date` |
| `datetime` | — | `datetime` |
| `enum` | — | `select` |
| `reference` | — | `readonly` |
| `file` | — | `file-upload` |
| default | — | `text` |

### ObservabilityModel

`traceEventKinds` is the sorted union of:

- every distinct `emit-trace` effect `eventKindRef` surfaced by the workflow
  builder (already `event.`-prefixed);
- every operation `auditEvent` (prefixed with `event.` if the AIM value did
  not already include it).

`producedBy` per event kind is inferred deterministically:
`runtime-operations` if produced by an operation, `runtime-workflow` if
produced by a transition effect, both if produced by both.

### IntegrationModel

Structural stub in v0.1: `{ version }`. Phase 3 fills endpoints + message
formats.

### DeploymentModel

Structural stub in v0.1: `{ version, topology: { mode: "unspecified" } }`.
Phase 5 fills topology + resource plan.

### MetadataModel

`{ version, appId, appVersion?, tenantId?, provenanceChain }` where
`provenanceChain` has three ordered links:

1. `stage: "bim"` — from `aim.metadata.sourceBim` (or `opts` fallbacks)
2. `stage: "aim"` — from `aim.metadata` + `opts.aimContentHash`
3. `stage: "cam"` — points at this CAM itself; `contentHash` is
   `sha256:__pending__` (permitted by the schema; self-referential hash is
   surfaced separately as `GenerateCamResult.camContentHash`)

### AIM sections with no CAM v0.1 representation

Each of these is dropped with an info diagnostic `CAM_GEN_AIM_SECTION_DROPPED`:

- `nonFunctional` (Phase 2+ — will surface as budgets and policies)
- `traceability` (Phase 2+ — will surface in the provenance viewer)
- `openIssues` (BIM-side concern; stays in AIM)
- `documents` (v0.1 folds this into rule-driven `require-documents` actions)

## Diagnostic codes

| Code | Severity | Meaning |
|---|---|---|
| `CAM_GEN_EFFECT_UNMAPPED` | warning | A state-machine effect was dropped because its `type` has no CAM v0.1 shape. |
| `CAM_GEN_EXPR_UNMAPPED` | warning | A rule expression fell back to `{ op: "always" }` because its shape is not in the CAM v0.1 AST. |
| `CAM_GEN_AIM_SECTION_DROPPED` | info | An AIM section was dropped because it has no CAM v0.1 slot. |
| `CAM_GEN_ADAPTER_INFERRED` | info | Records the inferred adapter for an operation. |
| `CAM_GEN_RULE_KIND_DEFAULT` | warning / info | A rule fell back to a default kind, or a currency literal was normalised. |
| `CAM_GEN_BOOLEAN_UNWRAPPED` | info | A `{and: [x]}` or `{or: [x]}` shorthand collapsed to `x`. |

## Determinism guarantees

The generator is a pure function. In particular:

- The generator never calls `Date.now()`, `new Date()`, or `Math.random()`.
  `generatedAt` is always injected by the caller.
- `contentHash()` canonicalises JSON (drops `undefined`, sorts keys, preserves
  array order) before hashing, so hash stability is independent of Node's
  object-key iteration order.
- Sub-model builders emit their outputs in deterministic order: AIM array
  order is preserved everywhere it matters (roles, entities, fields, state
  machines, transitions); trace event kinds are sorted by id; role/entity
  bindings preserve AIM insertion order.

## Build & test

```powershell
cd packages/canonical-application-generator
npm install --no-package-lock --no-audit --no-fund
npm run build
npm test
```

## References

- [`docs/schemas/cam.v0.1.schema.json`](../../docs/schemas/cam.v0.1.schema.json)
- [`docs/schemas/aim.v0.1.schema.json`](../../docs/schemas/aim.v0.1.schema.json)
- [ADR-011: BIM ↔ AIM boundary](../../docs/adr/ADR-011-bim-aim-boundary.md)
- [ADR-012: Canonical Application Model versioning](../../docs/adr/ADR-012-canonical-application-model-versioning.md)
- [ADR-013: Runtime engine contract](../../docs/adr/ADR-013-runtime-engine-contract.md)
