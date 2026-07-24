# @appbana/normalization-agent

BIM → AIM Normalization Agent for AppBana Genesis Phase 1 (WS-1.3).

Consumes a validated **Business Intent Model (BIM)**, invokes a structured-output
AI adapter against the versioned `prompt.normalization-agent.bim-to-aim` template,
validates the returned candidate against the **AIM v0.1 JSON Schema**, and records
provenance for every call.

Traces to [ADR-011 — BIM ↔ AIM boundary](../../docs/adr/ADR-011-bim-aim-boundary.md)
and [ADR-015 — AI model adapter layer](../../docs/adr/ADR-015-ai-model-adapter-layer.md).

## Design

The agent is a thin, deterministic orchestrator. Every heavy dependency is
injected so the agent works identically against Claude, GPT-4o, or a local
Llama — the choice is deployment config, not code.

- `AIModelAdapter` — supplies the model call. Must accept the
  `json-schema` response contract kind.
- `AIProvenanceStore` — every call is recorded, including failures.
  `assertProvenance()` refuses malformed provenance.
- `PromptRegistry` — the seed prompt
  `prompt.normalization-agent.bim-to-aim@1.0.0` ships in
  `@appbana/prompt-template-registry/prompts/`.
- `AimValidator` — a `(candidate) => AimValidationResult` function. The default
  helper `createAjvAimValidator({ schema })` wraps Ajv 2020-12 against the
  workspace's `docs/schemas/aim.v0.1.schema.json`.
- `buildInvocationContext` — factory the kernel uses to synthesize the
  `AIInvocationContext` (trace context, app/cam ids, environment, deterministic
  clock).

## Outcomes

Every call returns a `NormalizeBimResult` whose `outcome` is exactly one of:

| Outcome | Meaning |
|---|---|
| `produced` | AIM is schema-valid and contains no `[UNRESOLVED]` sentinel. Safe to hand off to the CAM generator. |
| `schema-invalid` | Adapter returned JSON that failed the AIM schema (or artifact was not an object). |
| `unresolved-fields` | AIM validated but the prompt-mandated `[UNRESOLVED]` sentinel appears in one or more fields. Feed diagnostics back to the clarification loop. |
| `ai-refused` | Model safety filter refused. |
| `ai-budget-exceeded` | Adapter refused before wire because worst-case cost / tokens breached the budget. |
| `ai-failed` | Network, timeout, upstream 5xx, aborted. |

## Provenance guarantees

- Every result includes an `ai.provenanceId` referencing an immutable record in
  the injected store. The kernel's downstream `check.ai-governance` gate
  refuses to consume any AIM whose provenance is missing.
- `bimContentHash` records the exact BIM bytes fed to the model — the CAM
  generator can prove which BIM produced which AIM downstream.
- `promptTemplateHash` and `renderedPromptHash` let auditors reproduce the exact
  prompt text years later.

## Usage

```ts
import {
  normalizeBim,
  createAjvAimValidator,
  type NormalizationAgentConfig,
} from "@appbana/normalization-agent";
import { loadRegistry } from "@appbana/prompt-template-registry";
import { readFileSync } from "node:fs";

const registry = await loadRegistry("packages/prompt-template-registry/prompts");
const aimSchema = JSON.parse(readFileSync("docs/schemas/aim.v0.1.schema.json", "utf8"));

const config: NormalizationAgentConfig = {
  adapter,
  provenanceStore,
  registry,
  aimValidator: createAjvAimValidator({ schema: aimSchema }),
  buildInvocationContext: (input) => ({
    tenantId: input.tenantId,
    appId: "app.customer-onboarding",
    camId: "cam.customer-onboarding",
    camVersion: "0.1.0",
    environment: "dev",
    traceContext: { traceId: "...", spanId: "..." },
    now: () => new Date(),
  }),
};

const result = await normalizeBim(
  {
    bim: myBim,
    tenantId: "tenant.acme",
    tenantName: "Acme Bank",
    correlationId: crypto.randomUUID(),
  },
  config,
);

if (result.outcome === "produced") {
  handOffToCamGenerator(result.aim);
}
```

## Status

Phase 1, WS-1.3 first deliverable. See
[`docs/phase1/README.md`](../../docs/phase1/README.md).
