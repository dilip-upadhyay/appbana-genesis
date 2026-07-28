# @appbana/governance-validator

Governance Publication Gate ([ADR-017](../../docs/adr/ADR-017-governance-publication-gate.md)) — Phase 1 subset.

Every CAM version activation in production MUST pass ten mandatory gate checks. This package ships the coordinator, three real checks (`check.schema-validation`, `check.operation-contract-validation`, and a deliberately narrow `check.accessibility-validation`), and seven `phase1Stub` implementations that return `passed` with an explicit evidence marker so downstream consumers can filter stub verdicts until each check lands its real implementation.

## Design goals

- **Fail-closed.** Missing verdicts collapse to `blocked`. A check that throws is recorded as `blocked` with `failureCode: "CHECK_THREW"`. A required check that is not registered raises `GateNotReadyError` at evaluate() time.
- **Deterministic.** Verdicts are sorted by `checkId` before emission; timestamps are supplied via an injected `clock`; the report id is content-addressed by sha-256 of the canonicalised (JCS-lite) seed. Two evaluations of an identical CAM against an identical registry produce byte-identical report ids.
- **Waivers enforced in code, not policy.** Attempting to submit a waiver for `check.schema-validation` or `check.runtime-compatibility` throws `WaiverForbiddenError`. High/critical criticality waivers require ≥ 2 approvers and expiry ≤ 30 days; violations throw `WaiverInvalidError`.
- **No coupling to metadata registry.** The Operation Contract registry is injected as a plain `Map<string, JsonObject>`. This package holds no runtime dependency on any storage layer.

## Public API

```ts
import {
  buildDefaultGate,
  GovernanceGate,
  MANDATORY_CHECK_IDS,
  NON_WAIVABLE_CHECK_IDS,
  operationContractKey,
  reportContentHash,
  schemaValidationCheck,
  operationContractValidationCheck,
} from "@appbana/governance-validator";

const gate = buildDefaultGate();

const report = await gate.evaluate(
  {
    cam,
    camSchema,
    operationContracts,
    deploymentMode: "saas",
    tenantId: "tenant-1",
    criticality: "medium",
  },
  {
    appId: "app.customer-onboarding",
    camId: "cam.customer-onboarding",
    camVersion: "0.1.0",
    clock: () => new Date().toISOString(),
    waivers: [],
  },
);

if (report.overallOutcome === "passed") {
  // Safe to swap the active-version pointer (Phase 2 responsibility).
}
```

## The ten mandatory checks

| # | Check id | Phase 1 status |
|---|---|---|
| 1 | `check.schema-validation` | ✅ REAL (v0.1.0) — Ajv 2020-12 validation of the CAM against `cam.v0.2.schema.json`. |
| 2 | `check.security-validation` | 🔒 Stub — `{phase1Stub: true}` |
| 3 | `check.privacy-validation` | 🔒 Stub |
| 4 | `check.accessibility-validation` | ⚠️ PARTIAL (v0.1.0) — enforces one invariant only: a CAM whose `InteractionModel.origin` is `generator-fallback` is **blocked** outside a `dev` environment ([ADR-018](../../docs/adr/ADR-018-presentation-intent-ownership.md)). A layout derived from a role × entity cross-product has no grouping, no reading order and no human labels; nobody looked at it. The environment is read from the CAM's own `metadata.environment` and an absent value fails closed. Evidence publishes `assertionsNotYetImplemented` (contrast, focus order, label association, target size, error identification) so a green verdict is not mistaken for an accessibility guarantee. |
| 5 | `check.operation-contract-validation` | ✅ REAL (v0.1.0) — every CAM operation has a contract; adapter kind + side effects consistent; `dispatch-operation` refs resolve. |
| 6 | `check.runtime-compatibility` | 🔒 Stub (also **non-waivable**) |
| 7 | `check.adapter-capability-coverage` | 🔒 Stub |
| 8 | `check.performance-budget` | 🔒 Stub |
| 9 | `check.ai-governance` | 🔒 Stub |
| 10 | `check.rollback-readiness` | 🔒 Stub |

## `check.schema-validation` failure taxonomy

Every blocked verdict carries a stable `failureCode` mapped from the underlying Ajv keyword:

| Ajv keyword | failureCode |
|---|---|
| `required` | `SCHEMA_MISSING_REQUIRED_FIELD` |
| `type` | `SCHEMA_TYPE_MISMATCH` |
| `enum` | `SCHEMA_ENUM_VIOLATION` |
| `pattern` | `SCHEMA_PATTERN_VIOLATION` |
| `additionalProperties` | `SCHEMA_ADDITIONAL_PROPERTY` |
| `format` | `SCHEMA_INVALID_FORMAT` |
| `minItems` | `SCHEMA_MIN_ITEMS` |
| `maxItems` | `SCHEMA_MAX_ITEMS` |
| `const` | `SCHEMA_CONST_VIOLATION` |
| any other | `SCHEMA_VALIDATION_FAILED` |
| schema itself fails to compile | `SCHEMA_COMPILE_FAILED` |

Evidence payload:

```jsonc
{
  "errorCount": 3,
  "errors": [
    { "instancePath": "/OperationModel/operations/0/adapter/kind",
      "keyword": "enum",
      "message": "must be equal to one of the allowed values",
      "failureCode": "SCHEMA_ENUM_VIOLATION",
      "params": { "allowedValues": ["internal", "data", "integration", "notification", "storage"] } }
  ]
}
```

## `check.operation-contract-validation` failure taxonomy

| failureCode | Condition |
|---|---|
| `OP_CONTRACT_MISSING` | CAM declares `operation.<id> v<N>` but no contract is in the injected registry. |
| `OP_CONTRACT_ID_MISMATCH` | `contract.id !== camOp.id` |
| `OP_CONTRACT_VERSION_MISMATCH` | `contract.version !== camOp.version` |
| `OP_CONTRACT_ADAPTER_KIND_MISMATCH` | `camOp.adapter.kind !== contract.adapter.kind` |
| `OP_SIDE_EFFECT_UNDECLARED` | A `sideEffect` declared on the CAM operation is absent from the contract's `sideEffects[]`. |
| `OP_REF_UNDECLARED` | A `WorkflowModel.stateMachines[*].transitions[*].effects[*]` of `type: "dispatch-operation"` references an `operationRef` that is not present in `OperationModel.operations[]` (via `operationContractKey(id, version)`). |
| `OP_MODEL_SHAPE_INVALID` | An entry in `OperationModel.operations[]` is missing `id` or `version`. |

Registry key format: `operationContractKey(id, majorVersion)` → `"<id>:v<N>"`. The check calls `parseOperationRef` on every `operationRef` to strip the `:vN` suffix; unparseable refs surface as `OP_REF_UNDECLARED`.

## Waiver rules (ADR-017 § "Waivers — Rare, Explicit, Time-Bounded")

- Waivers for `check.schema-validation` and `check.runtime-compatibility` → **rejected** at admission (`WaiverForbiddenError`).
- Any waiver: `issuedAt` must be valid ISO-8601; `expiresAt` must be strictly after `issuedAt`; at least one approver id.
- `criticality ∈ {high, critical}` → at least 2 distinct approvers AND `expiresAt - issuedAt ≤ 30 days`; violations throw `WaiverInvalidError`.
- A waiver only collapses a `blocked` verdict to `waived` when `now < expiresAt`.

## `GateReport` shape (v0.1)

```ts
interface GateReport {
  gateReportVersion: "0.1";
  id: string;              // content-addressed sha256 seed hash — stable for identical inputs
  camId: string;
  camVersion: string;
  tenantId: string;
  deploymentMode: "saas" | "dedicated-cloud" | "air-gapped";
  evaluatedAt: string;     // ISO-8601 UTC, from injected clock
  completedAt: string;
  overallOutcome: "passed" | "blocked";
  verdicts: GateCheckVerdict[];  // sorted by checkId, exactly 10
  prevActiveReportId?: string;
  rollbackFromReportId?: string;
  signatures: [];          // Phase 2 will populate with cosign sigs
}
```

`serializeReport(report)` returns canonical UTF-8 bytes (JCS-lite: undefined keys dropped, object keys sorted by UTF-16 code unit, arrays preserved) suitable for hashing and signing. `reportContentHash(report)` returns `sha256:<hex>` of those bytes.

## Determinism guarantees

- Given identical input + identical registered checks + a clock that returns the same string, `evaluate()` produces a byte-identical `GateReport`.
- Verdicts are sorted by `checkId` before emission.
- The default `newReportId` factory is content-addressed by a canonicalised seed of `(camId, camVersion, tenantId, evaluatedAt, verdictSummary)` so replays reuse the same report id without an external UUID service. Callers may inject a UUID factory when the application-specific replay contract requires opaque ids.

## Build & test

```powershell
cd packages/governance-validator
npm run build
npm test
```

- 50 tests across 6 files (canonical, waiver, schema-validation, operation-contract, accessibility-validation, gate)
- Full CAM schema validation of the shipped Customer Onboarding CAM
- ≥ 10 explicit negative-case tests covering the taxonomies of the real checks
