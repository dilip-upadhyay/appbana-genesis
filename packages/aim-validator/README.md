# @appbana/aim-validator

Full validator for **Application Intent Model (AIM) v0.1** documents.

Runs three passes in one call:

1. **JSON Schema validation** (Ajv 2020-12) against `docs/schemas/aim.v0.1.schema.json`.
2. **Symbol table collection** — every declared `id` from roles / enums / entities /
   state machines / operations / rules, plus duplicate-id detection.
3. **Cross-reference resolution** — every `enumRef` / `entityRef` / `referenceTo` /
   `assignedTo` / `stateMachineRef` / `triggeredBy` / `allowRoles` etc. must
   resolve to a symbol of the correct kind.

Traces to [ADR-011 — BIM ↔ AIM boundary](../../docs/adr/ADR-011-bim-aim-boundary.md).
Ships as the drop-in replacement for the schema-only default validator in
[`@appbana/normalization-agent`](../normalization-agent/README.md).

## Usage

### Full report

```ts
import { validateAim } from "@appbana/aim-validator";
import { readFileSync } from "node:fs";

const aim = JSON.parse(readFileSync("aim.json", "utf8"));
const schema = JSON.parse(readFileSync("docs/schemas/aim.v0.1.schema.json", "utf8"));

const report = validateAim(aim, { schema });
if (!report.valid) {
  console.error(report.summary);
  for (const e of report.schemaErrors) console.error("schema:", e);
  for (const e of report.referenceErrors) console.error("ref:", e);
  for (const e of report.duplicateIds) console.error("duplicate:", e);
}
```

### Plug into the Normalization Agent

```ts
import { normalizeBim } from "@appbana/normalization-agent";
import { createNormalizationAgentValidator } from "@appbana/aim-validator";

const aimValidator = createNormalizationAgentValidator({ schema: aimSchema });

const result = await normalizeBim(input, {
  adapter,
  provenanceStore,
  registry,
  aimValidator, // full schema + refs + duplicate detection
  buildInvocationContext,
});
```

## Error kinds

| Kind | Code (keyword) | When |
|---|---|---|
| Schema | Ajv keyword (`required`, `type`, `pattern`, …) | JSON Schema constraint failed. |
| Reference | `aim-reference` | Ref-carrying key points at unknown id or wrong kind. |
| Duplicate id | `unique-id` | Two definitions share an id. |

Every error carries a **JSON Pointer** so tooling can highlight the exact location.

## Reference-rule model

The v0.1 built-in ruleset (`DEFAULT_AIM_REFERENCE_RULES`) declares which
property keys carry references. Override with `options.referenceRules` for a
custom AIM dialect. Rules understand:

- `cardinality: "scalar" | "array"` — one id or many.
- `expects: AimSymbolKind[]` — allowed target kinds (`role`, `enum`, `entity`,
  `state-machine`, `operation`, `rule`).
- `allowVersionSuffix` — strip a trailing `:v<N>` before lookup (used by
  `triggeredBy` for operation refs).

Values that do not begin with a known kind prefix are ignored (avoids false
positives on free-form strings that happen to live under a ref-carrying key).
Element-level refs only — field-path references inside rule expressions
(`entity.customer.country`) are out of scope for v0.1.

## Status

Phase 1, WS-1.3 Task 2. See [`docs/phase1/README.md`](../../docs/phase1/README.md).
