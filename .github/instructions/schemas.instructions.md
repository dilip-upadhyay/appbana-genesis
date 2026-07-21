---
description: "Use when authoring, editing, or validating JSON Schemas for BIM, AIM, CAM, Operation Contract, or Trace Event. Covers schema conventions, versioning, the BIM vs AIM boundary contract, the 10 CAM sub-models, and round-trip validation requirements."
applyTo: "docs/schemas/**,packages/business-intent-model/**,packages/application-intent-schema/**,packages/canonical-application-model/**"
---

# Schema Authoring Instructions

## The Three Canonical Models

### Business Intent Model (BIM)
- Written in business language. Ambiguity is allowed and expected.
- Human-editable — a business user must be able to read and understand it.
- Contains: use cases, personas, rules in plain language, workflow as prose or timeline, non-functional intents ("should be fast", "must be SOX-compliant").
- Does NOT contain: typed entities, operation contracts, state machine definitions, security policy expressions.
- Schema `$id`: `https://schemas.appbana.dev/bim/v{major}.{minor}`

### Application Intent Model (AIM)
- Canonical and fully resolved. Zero ambiguity. Every reference must resolve.
- Produced by the AI Normalization/Resolution/Validation pipeline from the BIM — never hand-edited in normal flow (power-user escape hatch only).
- Contains: typed entities with fields and classifications, explicit role definitions, formal rule expressions, state machine with states/guards/transitions/effects, operation references.
- Schema `$id`: `https://schemas.appbana.dev/aim/v{major}.{minor}`

### Canonical Application Model (CAM)
- The execution artifact. Consumed only by the Platform Kernel and Runtime Engines — never by AI agents.
- Produced by the deterministic CAM Generator from the AIM. No AI involved.
- Contains all 10 sub-models (see below).
- Schema `$id`: `https://schemas.appbana.dev/cam/v{major}.{minor}`

## CAM Sub-Models (10 total)

| Sub-model | Consumed by | Key content |
|---|---|---|
| `InteractionModel` | UI Runtime | Screens, fields, field types, layout, conditional visibility |
| `WorkflowModel` | Workflow Runtime | States, transitions, guards, assignments, escalations |
| `RuleModel` | Rules Runtime | Named rules, conditions, actions, priorities |
| `OperationModel` | Operations Runtime | Semantic operations, input/output contracts, retry/idempotency |
| `DataModel` | Data Runtime | Entities, fields, relationships, keys, classifications |
| `IntegrationModel` | Integration Runtime | Endpoints, protocols, message formats, async patterns |
| `SecurityModel` | Security/Policy Runtime | Roles, permissions, ABAC policies, data classification |
| `ObservabilityModel` | Observability Runtime | Trace events, metrics, audit log requirements |
| `DeploymentModel` | Platform Kernel / Operator | Topology, resource requirements, environment config |
| `MetadataModel` | All | Version, appId, tenant, provenance chain, tags |

## Supporting Schemas

- **Operation Contract Schema** — defines the contract for one semantic operation: name, version, input schema, output schema, auth requirements, idempotency key, retry policy, error taxonomy.
- **Trace Event Schema** — defines one emitted trace event: eventId, appId, sessionId, userId, eventType, payload, timestamp, ruleId/operationId/fieldId (nullable), causalChain.

## Schema Conventions

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.appbana.dev/cam/v0.1",
  "title": "Canonical Application Model v0.1",
  "type": "object",
  "required": [...],
  "additionalProperties": false,
  ...
}
```

- Always set `"additionalProperties": false` at every object level in AIM and CAM. BIM may be more permissive.
- Use `$defs` for shared types within a schema. Use `$ref` for cross-schema references only when the referenced schema is also published.
- Every field that could be used for display must have a `"title"` and `"description"`.
- Use `"enum"` for closed value sets, `"const"` for fixed values.
- All IDs are strings (never integers) — they must be stable across versions.

## Versioning Rules

- **Patch** (0.0.x): clarifications, description improvements, adding `"description"` to existing fields. No structural change.
- **Minor** (0.x.0): additive — new optional fields, new optional sub-models. Backward-compatible. No migration needed.
- **Major** (x.0.0): any removal, rename, type change, or semantics change. Requires a migration entry in `packages/migration-engine/migrations/`.
- Schema file naming: `{model-name}.v{major}.{minor}.schema.json` (e.g., `cam.v0.1.schema.json`). Symlink the latest as `cam.schema.json`.
- The `$id` URL must match the version in the filename.

## Round-Trip Validation Requirement

The Customer Onboarding reference artifacts in `examples/customer-onboarding/` must:
1. `bim.json` validates against BIM schema — no errors.
2. `aim.json` validates against AIM schema — no errors.
3. `cam.json` validates against CAM schema — no errors.
4. Running the translation pipeline on `bim.json` produces `aim.json` (byte-identical modulo timestamps and provenance fields).
5. Running the CAM generator on `aim.json` produces `cam.json` (byte-identical modulo timestamps).

This round-trip test runs in CI for every schema change.

## What Not to Put in Schemas

- No executable code or scripting language constructs.
- No platform-specific implementation hints (e.g., "use React useState").
- No model provider names (e.g., "claudeModel").
- No hard-coded tenant IDs, user IDs, or environment-specific values.
- No arbitrary JSON escape hatches (`additionalProperties: true` on AIM/CAM objects).

## File Locations

```
docs/schemas/
  bim.v0.1.schema.json
  bim.schema.json          → symlink to latest
  aim.v0.1.schema.json
  aim.schema.json
  cam.v0.1.schema.json
  cam.schema.json
  operation-contract.v0.1.schema.json
  trace-event.v0.1.schema.json
```

TypeScript types are generated from these schemas into `packages/*/src/generated/`. Never edit generated files — edit the schema and regenerate.
