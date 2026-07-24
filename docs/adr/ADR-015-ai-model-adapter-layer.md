# ADR-015: AI Model Adapter Layer & Provenance

- **Status:** Accepted (amended 2026-08-06 — provenance bumped to v0.2, adds required `tenantId`)
- **Date:** 2026-07-24
- **Deciders:** Dilip
- **Consulted:** AI Agent team (BA Agent, Normalization Agent, CAM Generator), Governance team (ADR-017 pending), Security & Data-Residency team, Deployment team (ADR-016 pending)

## Amendment 2026-08-06 — aiProvenanceVersion 0.2

Bumped `aiProvenanceVersion` from `"0.1"` to `"0.2"`. Added required `tenantId` field to every provenance record. Rationale: multi-tenant deployments need tenant attribution at record-insert time for RLS enforcement, per-tenant cost aggregation, and forensic queries. Threading `tenantId` through `AIInvocationContext` was already required, so the addition is source-only — no live records existed prior to the bump, so no data migration is needed. Also fixed docstring examples that showed `promptTemplateRef` with an inline `:v<n>` suffix; the bare form `prompt.<agent>.<task>` is canonical and the version lives exclusively in `promptTemplateVersion`.


## Context and Problem Statement

AppBana Genesis is AI-native: the platform's own operation depends on large-model calls for the BA Agent (natural-language intake → BIM), the Normalization Agent (BIM → AIM), the CAM Generator (AIM → CAM), and later the Validation Agent, Domain Modeler, and Change Impact Agent. Each agent has a different task profile (long-context reasoning vs. structured extraction vs. speech transcription vs. embedding) and each **enterprise deployment** has a different constraint profile:

- SaaS multi-tenant: cloud frontier models (Anthropic, OpenAI, Google) chosen for capability.
- Dedicated cloud: same models, but pinned to the customer's region and tenant.
- Air-gapped on-prem: local models only (Llama 3.3 70B, Whisper) — no outbound network.
- Regulated verticals (banking, healthcare, government): specific model licensing, data-residency, PII-non-egress, and audit-log requirements.

Hard-wiring a single provider or model into agent code would make the platform unshippable to a large fraction of the target market. Equally, letting each agent freely call any SDK it wants would make provenance impossible — and provenance is the load-bearing element of the [governance publication gate](ADR-017-governance-publication-gate.md) for anything AI-generated.

We need a **stable contract** between agents and models — parallel to the [Technology Adapter contract](ADR-014-technology-adapter-contract.md), but for a fundamentally different kind of boundary. Technology adapters perform *effects* against the outside world. **AI model adapters produce *artifacts*** (BIM patches, AIM structures, CAM fragments, embeddings, transcripts) that flow back through deterministic normalization pipelines. Confusing the two would corrupt both.

## Decision Drivers

- **Model choice is a customer decision, not a platform decision.** The same agent code must run against Claude, GPT-4o, Llama, or Qwen — chosen by deployment configuration.
- **Every AI call must be attributable and reproducible-enough for audit.** Model, model version, prompt template id + version, canonicalized input hash, output hash, token counts, wall-clock timestamp, latency, requesting agent, and human-review status if applicable.
- **Prompt templates are versioned first-class artifacts** — not string literals scattered through TypeScript. Changing a prompt is a code review and a semver bump.
- **AI output is untrusted until validated.** Every model output flows through a deterministic schema validator (Ajv against BIM, AIM, or CAM schemas) before it can advance in the pipeline. Adapters never mutate platform state directly.
- **Air-gapped deployments must work.** Adapters with `requiresNetwork: true` are refused in air-gapped mode, exactly as with technology adapters (ADR-014).
- **PII must not egress to third-party model providers** unless the CAM's `dataClassifications` policy explicitly allows it, per tenant, per environment.
- **Cost and rate limits are a first-class concern.** Adapters must expose budget, throttling, and back-pressure so the CAM Generator does not silently rack up a bill or DoS a local GPU.
- **The interface must survive model paradigm shifts.** Tool-use APIs, structured-output modes, and reasoning-model round-trips are all evolving. The contract must accommodate them without becoming leaky.

## Considered Options

### Option A — Hard-code a single provider per agent

Fastest to Phase 1; kills the enterprise story. **Rejected.**

### Option B — Thin "call the model" wrapper per agent (custom HTTP calls, no shared interface)

Each agent embeds its own SDK. **Rejected.** Interface drift across ~6 agents makes governance, provenance, and rate-limit accounting impossible. Same failure mode ADR-014 rejected for technology adapters (Option B there).

### Option C — Reuse the `TechnologyAdapter` interface from ADR-014 with a new adapter kind `ai-model`

Superficially attractive; would give a single adapter contract for everything. **Rejected.** The two boundaries have fundamentally different semantics:
- Technology adapters take a deterministic `EffectDescriptor` and produce a bounded `AdapterResult`. Success = the effect happened.
- AI model adapters take a prompt + context and produce an *artifact that must then be schema-validated*. Success ≠ downstream acceptance.
- Provenance requirements differ: technology adapters need `reproducibilityHash`; AI adapters need model+prompt+token provenance plus artifact hashing for governance replay.
- Failure modes differ: partial JSON, hallucinated fields, refused output, tool-use loops, streaming truncation. None of these map onto the technology-adapter `outcome` enum cleanly.

Forcing one contract would either weaken the technology-adapter guarantees or bloat them with AI-specific fields most implementations would ignore.

### Option D — Separate `AIModelAdapter` interface with declared capabilities, parallel governance treatment, artifact-first output *(chosen)*

One interface for AI models, parallel to but distinct from the technology adapter interface. Agents declare which AI capability they need (`text-generation`, `structured-output`, `embedding`, `speech-to-text`, `vision`); the kernel routes each call to the adapter satisfying that capability under the deployment's model-routing policy. Every call returns an `AIInvocationResult` carrying the artifact **and** the mandatory provenance record.

## Decision

We adopt **Option D**: a dedicated `AIModelAdapter` layer with its own interface, capability declarations, provenance schema, prompt-template registry, and conformance suite. AI model adapters are structurally similar to technology adapters (ADR-014) but operate on a different axis and are governed under separate publication-gate predicates.

### The Five AI Adapter Kinds (v0.1)

The `adapter.kind` for AI adapters is disjoint from the technology-adapter kinds:

| Kind | Purpose | Reference adapters (Phase 1–5) |
|---|---|---|
| `text-generation` | Free-form or tool-using text completion; the workhorse for BA Agent conversational intake and Normalization Agent reasoning. | `ai:anthropic-claude`, `ai:openai-gpt`, `ai:local-llama`, `ai:azure-openai` |
| `structured-output` | Schema-constrained JSON generation used by the CAM Generator, Validation Agent, and Change Impact Agent. Model MUST support a structured/JSON-mode API. | `ai:anthropic-claude-json`, `ai:openai-gpt-json`, `ai:local-llama-json` |
| `embedding` | Dense vector generation for semantic search over BIM/AIM/CAM archives and prompt-template retrieval. | `ai:openai-embed`, `ai:local-bge`, `ai:azure-openai-embed` |
| `speech-to-text` | Voice intake for the BA Agent (Phase 3 multi-modal). | `ai:openai-whisper`, `ai:local-whisper`, `ai:azure-speech` |
| `vision` | Screenshot / diagram intake for BA Agent (Phase 3 multi-modal). Extracts structured description or transcribed text from images. | `ai:anthropic-vision`, `ai:openai-vision`, `ai:local-llava` |

Additional kinds (`reranker`, `code-completion`, `function-calling-router`) require an ADR amendment (patch bump of this ADR).

**AI adapter kinds intentionally do not collide with the five technology-adapter kinds (`internal | data | integration | notification | storage`).** A registered adapter is unambiguously either an AI adapter or a technology adapter based on its manifest, and the kernel maintains two separate registries.

### The `AIModelAdapter` Interface

Every AI adapter package exports one class per adapter identity that implements:

```ts
export interface AIModelAdapter<TCapability extends AICapabilityKind = AICapabilityKind> {
  /** Identity — kind + binding used to match deployment routing policy. */
  readonly kind: TCapability;                             // "text-generation" | "structured-output" | "embedding" | "speech-to-text" | "vision"
  readonly binding: string;                               // e.g. "ai:anthropic-claude", "ai:local-llama"

  /** Static capability declaration. Read at kernel startup; never mutated. */
  readonly capabilities: AIAdapterCapabilities;

  /** Called once at kernel startup after config load. Verify credentials, warm caches, load local model weights. */
  init(config: AIAdapterConfig, ctx: AIAdapterInitContext): Promise<void>;

  /** Called on every agent invocation the kernel routes to this adapter. */
  invoke(
    request: AIInvocationRequest,
    ctx: AIInvocationContext
  ): Promise<AIInvocationResult>;

  /** Optional streaming variant. Present iff capabilities.streaming === true. */
  invokeStream?(
    request: AIInvocationRequest,
    ctx: AIInvocationContext
  ): AsyncIterable<AIInvocationChunk>;

  /** Called at graceful shutdown. Close connections, unload weights. */
  shutdown(): Promise<void>;

  /** Health probe consumed by the platform readiness endpoint. */
  health(): Promise<AIAdapterHealth>;
}
```

The invocation request carries the resolved prompt template, the runtime inputs, and the response contract the caller expects:

```ts
export interface AIInvocationRequest {
  readonly promptTemplateRef: string;                     // bare form, e.g. "prompt.ba-agent.intake" — version lives in promptTemplateVersion
  readonly promptTemplateVersion: string;                 // semver — MUST match a registered template
  readonly inputs: Readonly<Record<string, unknown>>;     // template variables — hashed for provenance
  readonly responseContract: AIResponseContract;          // schema the output must match (structured kinds) or "free-text"
  readonly budget: AIBudget;                              // token / latency / cost caps enforced by the adapter
  readonly toolCatalogRef?: string;                       // tool-use catalog id for models that support tool calling
  readonly seed?: number;                                 // optional determinism hint; adapters MAY ignore
  readonly correlationId: string;                         // echoed from the agent invocation
}
```

And the invocation result carries both the artifact and the mandatory provenance record:

```ts
export interface AIInvocationResult {
  readonly outcome: "accepted" | "schema-invalid" | "refused" | "budget-exceeded" | "failed";
  readonly artifact?: unknown;                            // the model output; validated against responseContract when outcome === "accepted"
  readonly diagnostics: Diagnostic[];                     // same shape as ADR-013 Diagnostic
  readonly provenance: AIProvenanceRecord;                // MANDATORY — see next subsection
  readonly traceEvents: TraceEvent[];                     // MUST include at least one 'event.ai.invoked' event
  readonly correlationId: string;                         // echoed from the request
}
```

Adapters MUST NOT throw for expected failure modes (schema-invalid output, safety refusal, budget cap hit, quota exhausted, upstream timeout). Exceptions are reserved for programmer errors.

### Provenance Record — Mandatory on Every Call

```ts
export interface AIProvenanceRecord {
  readonly aiProvenanceVersion: "0.2";
  readonly tenantId: string;                              // opaque tenant identifier; never contains raw PII
  readonly modelBinding: string;                          // adapter binding, e.g. "ai:anthropic-claude"
  readonly modelName: string;                             // vendor-canonical name, e.g. "claude-sonnet-4-5"
  readonly modelVersion: string;                          // vendor-published version string
  readonly modelProviderRegion?: string;                  // where the call was served (data residency)
  readonly promptTemplateRef: string;                     // bare form, e.g. "prompt.ba-agent.intake"
  readonly promptTemplateVersion: string;                 // semver
  readonly promptTemplateHash: string;                    // sha256 of the resolved prompt text (post-variable-substitution)
  readonly inputHash: string;                             // sha256 of a canonicalized inputs object
  readonly outputHash: string;                            // sha256 of the raw model output (pre-validation)
  readonly tokenUsage: { readonly input: number; readonly output: number; readonly total: number };
  readonly wallClockMs: number;
  readonly requestedAt: string;                           // ISO-8601 UTC
  readonly completedAt: string;                           // ISO-8601 UTC
  readonly requestingAgent: string;                       // e.g. "agent.ba-agent", "agent.normalization", "agent.cam-generator"
  readonly humanReview?: {
    readonly required: boolean;
    readonly status: "pending" | "approved" | "rejected" | "not-required";
    readonly reviewerId?: string;                         // opaque; no raw PII
    readonly reviewedAt?: string;
  };
  readonly redactions: readonly {
    readonly path: string;                                // JSON Pointer into the request inputs
    readonly classification: string;                      // e.g. "pii", "sensitive-pii"
    readonly action: "removed" | "masked" | "hashed" | "truncated";
    readonly policyRef?: string;
  }[];
}
```

Every `AIInvocationResult` MUST carry a complete provenance record, including for `outcome === "failed"` (so failed calls remain auditable). The record is persisted by the kernel to the AI provenance store and emitted as an `event.ai.invoked` trace event (per the [Trace Event v0.1 schema](../schemas/trace-event.v0.1.schema.json)).

**Nothing in the platform may consume a model output whose provenance record is missing or invalid.** This includes downstream normalization pipelines, the CAM Generator's persistence step, and the governance publication gate.

### Prompt Template Registry

Prompt templates are versioned artifacts, not string literals:

- Templates live in `packages/ai-application-agent/prompts/<agent>/<task>.<version>.prompt.md` (and equivalent paths for other agent packages).
- Every template has a stable ref (`prompt.<agent>.<task>`) and a semver version.
- The template body uses a documented variable-substitution syntax; the substituted text is what gets hashed into `promptTemplateHash`.
- A prompt-template registry index (`packages/ai-application-agent/prompts/index.json`) maps ref → available versions → file path.
- Changing a template body is a **patch bump minimum**; adding/removing/renaming variables is a **minor bump**; changing the semantic contract of the template (what the model is expected to return) is a **major bump**.
- Deleting a template version is forbidden if any AI provenance record still references it — templates are append-only for the lifetime of any CAM that consumed them.

Adapters do not choose templates. Agents resolve `(promptTemplateRef, promptTemplateVersion)` from their own logic (usually pinned in agent config) and hand the resolved template body to the adapter as part of the invocation request.

### Capability Declaration

```ts
export interface AIAdapterCapabilities {
  readonly kind: AICapabilityKind;
  readonly binding: string;
  readonly modelName: string;
  readonly modelVersion: string;
  readonly modelProviderRegion?: string;
  readonly supportedResponseContracts: readonly ("free-text" | "json-schema" | "tool-use" | "embedding-vector" | "transcript")[];
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly supportsStreaming: boolean;
  readonly supportsToolUse: boolean;
  readonly supportsStructuredOutput: boolean;             // native JSON-mode / structured-output support
  readonly supportsDeterminismHint: boolean;              // honors the `seed` field in requests
  readonly requiresNetwork: boolean;                      // MUST be false for air-gapped adapters
  readonly dataResidencyGuarantee?: string;               // e.g. "eu-central-1"; absent = no guarantee
  readonly egressesInputsToThirdParty: boolean;           // MUST be false for adapters usable when tenant policy forbids third-party egress
  readonly costPerInputToken?: number;                    // in USD; optional for local models
  readonly costPerOutputToken?: number;
  readonly rateLimitTokensPerMinute?: number;
  readonly conformanceTier: "A" | "B" | "C";              // see next section
  readonly adapterVersion: string;                        // adapter semver, independent of platform version
  readonly minPlatformKernelVersion: string;
}
```

### Conformance Tiers

Parallel to ADR-014 but with AI-specific test suites:

- **Tier C — "Runnable"** — Passes basic invoke / init / shutdown / health suite for the declared kind. Produces valid provenance records. Sufficient for local dev and demo.
- **Tier B — "Production-viable"** — Adds concurrency, rate-limit-respect, budget-enforcement, schema-validation-under-partial-output, and graceful-degradation-under-quota tests. Required for SaaS or dedicated-cloud deployments.
- **Tier A — "Regulated-workload"** — Adds redaction-policy-enforcement (never egresses PII when tenant policy forbids), data-residency-verification, audit-log integrity, prompt-template-hash stability across model version bumps, and human-review-gate enforcement. Required for financial, healthcare, air-gapped, or government deployments.

The [governance publication gate](ADR-017-governance-publication-gate.md) will refuse to activate a CAM whose AI-generated changes were produced by an adapter of lower tier than the CAM's declared criticality demands.

### Agent-to-Model Routing Policy

Agents do not name specific adapters. Deployment configuration (Helm values / Operator CR — see [ADR-016](ADR-016-deployment-packaging.md)) declares a **routing policy** mapping `(agent, capability-kind) → adapter binding`:

```yaml
aiRouting:
  agent.ba-agent:
    text-generation: ai:anthropic-claude
    speech-to-text:  ai:openai-whisper
  agent.normalization:
    structured-output: ai:anthropic-claude-json
  agent.cam-generator:
    structured-output: ai:anthropic-claude-json
  agent.validation:
    structured-output: ai:openai-gpt-json
```

For air-gapped deployments the same routing yaml simply names the local bindings:

```yaml
aiRouting:
  agent.ba-agent:
    text-generation: ai:local-llama
    speech-to-text:  ai:local-whisper
  agent.normalization:
    structured-output: ai:local-llama-json
  agent.cam-generator:
    structured-output: ai:local-llama-json
```

**No agent code changes between the two deployments.** The kernel resolves `(agent, capability-kind)` to a bound adapter at load time and refuses to start if any (agent, capability-kind) pair used by loaded agents lacks a route.

### Discovery and Binding

AI adapters are packaged as `@appbana/adapter-ai-<name>` npm packages. Each package MUST export:

1. An `ai-manifest.json` conforming to the AI Adapter Manifest schema (Phase 1 follow-up, parallel to the ADR-014 Adapter Manifest deliverable).
2. A default-exported class implementing `AIModelAdapter`.

Kernel load sequence (parallel to but separate from the technology-adapter path):

1. Kernel reads all registered AI adapter manifests.
2. Kernel reads the deployment's `aiRouting` policy.
3. For each `(agent, capability-kind)` binding it selects the **unique** registered AI adapter with matching identity. Ambiguous matches → load fails.
4. Kernel verifies the deployment mode's constraints (e.g., air-gapped → `requiresNetwork` MUST be false; PII-non-egress → `egressesInputsToThirdParty` MUST be false for any adapter serving an agent that processes PII).
5. Kernel calls `adapter.init(config, ctx)` once per adapter. Init failures → load fails.

**A CAM is not blocked by AI adapter mismatch** (unlike technology adapters — see ADR-014). CAMs are already-generated artifacts; they only need AI adapters if they are subsequently *modified* through the agent pipeline. However, an AppBana Genesis **platform instance** with any AI agent enabled *is* blocked from startup if routing is incomplete or incompatible with the deployment mode.

### PII, Data Residency, and Egress Policy

Every tenant carries a `tenantAIPolicy` object (Phase 2 schema, referenced here) with:

- `allowThirdPartyModelEgress: boolean` — if false, kernel refuses to route any invocation whose adapter has `egressesInputsToThirdParty === true`.
- `dataResidencyRequired?: string` — if set, kernel refuses to route to any adapter whose `dataResidencyGuarantee` doesn't match.
- `redactionPolicy: "strict" | "standard" | "minimal"` — feeds into the adapter's redaction step before egress.

Redaction happens inside the adapter's `invoke()` **before any network call**. The `redactions` array in the resulting provenance record documents what was removed/masked.

### Budgets, Rate Limits, and Back-Pressure

Every invocation carries an `AIBudget`:

```ts
export interface AIBudget {
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxWallClockMs?: number;
  readonly maxCostUsd?: number;                           // enforced only when adapter declares cost fields
}
```

Adapters MUST enforce budgets and return `outcome: "budget-exceeded"` (with a populated provenance record) rather than exceed them. The kernel tracks aggregate token / cost usage per tenant per model and applies rate-limit back-pressure by queueing or shedding.

### Reproducibility for AI Calls

AI adapters are non-deterministic — even with `seed` set, most providers do not guarantee bit-identical output. But the provenance record supports **replay comparison**: given the same `(promptTemplateHash, inputHash, modelName, modelVersion)`, a re-invocation MAY produce a different `outputHash`, but the divergence is auditable and comparable via the Trace Viewer. This is the AI-adapter analogue of the `reproducibilityHash` requirement in ADR-014 for technology adapters.

### Conformance Suite Location

Every AI adapter package MUST include a `conformance/` directory mirroring the layout from ADR-013 and ADR-014:

- `conformance/fixtures/` — invocation requests covering the declared response contracts.
- `conformance/expectations.json` — expected outcome shapes (not exact bytes; models are non-deterministic).
- `conformance/tier.json` — declared tier + which extended tests must pass.
- `conformance/conformance.test.ts` — imports the shared `@appbana/ai-adapter-conformance-suite` runner and passes the fixtures.

Adapter CI must run the suite and fail the build on any regression.

## Consequences

### Positive

- The **hard boundary** between deterministic agents-plus-normalization and non-deterministic model calls is enforced by types, capability declarations, and load-time refusal — not by developer discipline.
- Swapping model providers (Claude → GPT-4o → Llama) becomes a **deployment-time configuration change**, not an agent code change.
- Air-gapped and PII-non-egress deployments are first-class scenarios enforced by the kernel at load, not a documentation footnote.
- Every AI-generated artifact carries the provenance the governance publication gate needs to make a defensible allow/deny decision.
- Prompt templates are versioned artifacts; prompt regressions become git-diffable and reviewable.
- The clean separation from ADR-014 lets each contract evolve independently: technology-adapter changes don't break AI agents, and vice versa.
- Third parties can build and certify AI adapters (e.g., customer-specific fine-tuned models) without changing platform code.

### Negative

- Two adapter registries, two conformance suites, two manifest schemas. More surface area for the platform team. Justified by the semantic distance between the two boundaries.
- Provenance storage and trace-event volume grow linearly with agent activity. Retention policy (Phase 2) must address.
- Adapters must implement redaction correctly. This is a real cost, especially at Tier A, but the alternative (silent PII egress) is unshippable in regulated verticals.
- Prompt-template append-only-for-life-of-referencing-CAMs is a hard discipline — expect early friction with agent teams who want to "just fix" a bad prompt.

### Neutral

- The interface is TypeScript-first for v0.1. Java-adapter-friendly IDL generation is a Phase 4/5 deliverable, aligned with the Java technology-adapter arrival.
- The Phase 0 seed of five AI adapter kinds is expected to expand. New kinds arrive by ADR-014-style amendment (patch bump of this ADR).

## Follow-ups

- **AI Adapter Manifest v0.1 schema** — machine-readable form of `AIAdapterCapabilities`. Owned by the AI Agent team; ships alongside the first reference adapters in Phase 1.
- **`@appbana/ai-adapter-conformance-suite`** — shared test runner. Phase 1 with initial Tier C tests; Tier B in Phase 2; Tier A in Phase 4 (aligned with regulated-vertical design partners).
- **Prompt Template Registry v0.1** — index schema + versioning enforcement tooling. Ships in Phase 1 alongside the BA Agent.
- **Reference adapters for Phase 1** — `ai:anthropic-claude` (SaaS path) and `ai:local-llama` (air-gapped path), both `text-generation` and `structured-output` kinds. Sufficient to run the BA Agent + Normalization Agent + CAM Generator end-to-end for Customer Onboarding.
- **`tenantAIPolicy` schema (Phase 2)** — formalizes egress / residency / redaction rules referenced above.
- **AI Provenance Store (Phase 1)** — append-only persistence for `AIProvenanceRecord`. Queryable by the Trace Viewer and by the governance gate.
- **ADR-017 hook point** — governance gate refuses activation of any CAM version whose latest AI-generated changes lack an approved `humanReview.status` when the CAM criticality demands it, and refuses activation when the producing adapter's tier is below the CAM's declared criticality.

## References

- [ADR-011 — BIM vs AIM Boundary](ADR-011-bim-aim-boundary.md)
- [ADR-013 — Runtime Engine Contract](ADR-013-runtime-engine-contract.md)
- [ADR-014 — Technology Adapter Contract & Conformance](ADR-014-technology-adapter-contract.md)
- [Trace Event v0.1 schema](../schemas/trace-event.v0.1.schema.json)
- [BIM v0.1 schema — metadata.provenance](../schemas/bim.v0.1.schema.json)
- [AIM v0.1 schema — metadata.provenance](../schemas/aim.v0.1.schema.json)
- [CAM v0.1 schema — metadata.provenance](../schemas/cam.v0.1.schema.json)
- [architecture.md § 7 — AI Application Agent](../../architecture.md)
- [architecture.md § 17 — AI Governance Architecture](../../architecture.md)
- [execution-plan.md — Phase 1 WS-1.2](../../execution-plan.md)
