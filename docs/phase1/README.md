# Phase 1 — AI Intake + Minimal Runtime

This is the live tracker for Phase 1. See [execution-plan.md](../../execution-plan.md#phase-1--ai-intake--minimal-runtime-the-describe--deploy-proof) for the full plan.

**Duration target:** 10–12 weeks
**Team:** 6–8 people (existing Phase 0 team + UI engineer + backend engineer + DevOps)

**Primary Deliverable:** A business user describes Customer Onboarding in a chat interface → the platform produces a running form with conditional rules and mock operations. Zero hand-written metadata. Full trace visibility via the Trace Viewer.

**North-star demo:** Recorded video — business user goes from empty chat to a running Customer Onboarding form in under 15 minutes, with every field render / rule fire / operation call visible in the Trace Viewer.

## Workstream Status

### WS-1.1 Conversational BA Agent (chat-only, no audio yet)

Depends on: WS-1.2 (AI adapters), WS-1.3 (BIM schema already published in Phase 0).

| Task | Estimate | Acceptance Criterion | Status | Owner |
|---|---|---|---|---|
| Chat UI shell (Next.js + shadcn/ui) | 1 wk | User can open the chat page, send a message, receive a streamed reply, see message history persisted across page reloads. | ⏳ | _TBD_ |
| Thread/session persistence in Postgres | 3 d | New `chat_sessions` + `chat_messages` tables; every message and every agent turn stored with correlationId matching the AI provenance record. | ⏳ | _TBD_ |
| BA agent orchestration state machine | 2 wk | Explicit states `intake → clarify → confirm → publish`; each state transition emits a Trace Event; state machine survives process restart via serialized state in the session row. | ⏳ | _TBD_ |
| Clarification loop | 1 wk | Agent asks at most one question per turn; each answer produces a diff against the in-progress BIM; user can view/revert diffs. | ⏳ | _TBD_ |
| Use-case + test-scenario generation | 1 wk | For a completed BIM, agent produces `useCases[]` and `scenarios[]` blocks that validate against BIM v0.1 schema. | ⏳ | _TBD_ |
| Confirmation presentation | 3 d | Agent renders the in-progress BIM in readable form (natural-language summary, not JSON); "Looks right?" prompt precedes any `publish` transition. | ⏳ | _TBD_ |

**WS-1.1 exit:** A first-time user can describe Customer Onboarding from scratch, see the BIM take shape, correct any misinterpretations, and click **Publish** to advance to normalization.

---

### WS-1.2 AI Model Adapter Layer

Depends on: [ADR-015](../adr/ADR-015-ai-model-adapter-layer.md).

| Task | Estimate | Acceptance Criterion | Status | Owner |
|---|---|---|---|---|
| `AIModelAdapter` TypeScript interface package | 3 d | `packages/adapter-ai-contract` exports the interface, capability types, `AIInvocationRequest`/`Result`/`ProvenanceRecord`, and `AIBudget` per ADR-015 verbatim. Passes typecheck + lint. | ✅ Done (2026-07-24) — [`@appbana/adapter-ai-contract`](../../packages/adapter-ai-contract/) v0.1.0; typecheck + 7-test smoke suite green | Dilip |
| AI Adapter Manifest v0.1 JSON Schema | 3 d | Schema published at `docs/schemas/ai-adapter-manifest.v0.1.schema.json`, validated by CI against a fixture; registered in `tools/validate-schemas/schemas.manifest.json`. | ✅ Done (2026-07-24) — schema + 2 reference-adapter fixtures (Claude, local Llama); validator 6/6 pairs green | Dilip |
| Claude Sonnet 4.5 adapter (`ai:anthropic-claude`) | 1 wk | Package `@appbana/adapter-ai-anthropic-claude` implements both `text-generation` and `structured-output` kinds; passes Tier C conformance suite; produces valid `AIProvenanceRecord` on every call including failures. | ✅ Done (2026-07-24) — [`@appbana/adapter-ai-anthropic-claude`](../../packages/adapter-ai-anthropic-claude/) v0.1.0; 16/16 tests green (text-gen + structured-output + Tier B conformance); Anthropic SDK injected via `clientFactory` (no bundled dep) | Dilip |
| Local Llama adapter (`ai:local-llama`) | 1.5 wk | Package `@appbana/adapter-ai-local-llama` targets Llama 3.3 70B via llama.cpp/vLLM; `requiresNetwork: false`; runs in air-gapped bundle; passes Tier C conformance. | ✅ Done (2026-07-24) — [`@appbana/adapter-ai-local-llama`](../../packages/adapter-ai-local-llama/) v0.1.0; 17/17 tests green (text-gen + structured-output + **Tier A** conformance including determinism, air-gapped invariant, on-prem residency, redaction); OpenAI-compatible chat-completions client injected via `clientFactory` (works with Ollama / llama.cpp / vLLM / LM Studio) | Dilip |
| Prompt Template Registry v0.1 | 1 wk | `packages/ai-application-agent/prompts/index.json` + versioning enforcement tool; deleting a version referenced by any provenance record fails CI; `promptTemplateHash` reproducible across runs. | ✅ Done (2026-07-24) — [`@appbana/prompt-template-registry`](../../packages/prompt-template-registry/) v0.1.0; 28/28 tests green (hash + load + render + validate + shipped-seed integration); ships `prompt-registry-check` CLI that fails CI on `PROVENANCE_REF_MISSING` / `PROVENANCE_HASH_MISMATCH`; 2 seed prompts (`ba-agent/intake@1.0.0`, `normalization-agent/bim-to-aim@1.0.0`) validated on disk | Dilip |
| AI Provenance Store | 4 d | Append-only Postgres table (`ai_provenance`) + query API; kernel refuses to consume any AI output whose provenance is missing or invalid. | ⏳ | _TBD_ |
| Cost & token tracking | 3 d | Per-tenant per-model daily counters; `AIBudget.maxCostUsd` enforced at adapter level with `outcome: "budget-exceeded"`. | ⏳ | _TBD_ |
| `@appbana/ai-adapter-conformance-suite` (Tier C only for Phase 1) | 1 wk | Reusable test runner; both reference adapters pass; documented as the sole path to certification. | ✅ Done (2026-07-24) — [`@appbana/ai-adapter-conformance-suite`](../../packages/ai-adapter-conformance-suite/) v0.1.0; 16 checks across tiers C/B/A; 8/8 self-tests green against a fake adapter | Dilip |
| Supporting: `@appbana/security-redaction` v0.1 | (spawned from Claude adapter work) | Deterministic redaction library invoked by every AI adapter before wire; emits `AIProvenanceRedaction[]` entries; default rules cover PII (SSN, email, phone) + PCI (card numbers). | ✅ Done (2026-07-24) — [`@appbana/security-redaction`](../../packages/security-redaction/) v0.1.0; 10/10 tests green | Dilip |

**WS-1.2 exit:** A single yaml switch (`aiRouting`) flips the platform between Claude and local Llama with no code change; both paths produce identical `AIProvenanceRecord` shapes; conformance suite is green.

---

### WS-1.3 Intent Translation Pipeline

Depends on: WS-1.2 (adapters), Phase 0 BIM/AIM/CAM schemas.

| Task | Estimate | Acceptance Criterion | Status | Owner |
|---|---|---|---|---|
| BIM → AIM Normalization Agent | 2 wk | Agent consumes a validated BIM, invokes the `structured-output` AI capability against a versioned prompt template, and produces an AIM that validates against `aim.v0.1.schema.json`. All AI calls have provenance. | ⏳ | _TBD_ |
| AIM validator (schema + reference resolution) | 3 d | Rejects AIM where any `$ref` points to an undefined enum / entity / role; produces machine-readable diagnostics with JSON Pointers. | ⏳ | _TBD_ |
| AIM → CAM Canonical Generator (deterministic, no AI) | 2 wk | Pure function of AIM + generator version; identical input produces byte-identical CAM; CAM validates against `cam.v0.1.schema.json`; documented mapping table AIM→CAM for every construct. | ⏳ | _TBD_ |
| Governance Validator — Phase 1 subset | 1 wk | Implements `check.schema-validation` + `check.operation-contract-validation` from [ADR-017](../adr/ADR-017-governance-publication-gate.md); other 8 checks stubbed to return `passed` with an explicit `evidence: {phase1Stub: true}` marker. | ⏳ | _TBD_ |
| Metadata Registry — v0.1 | 1 wk | Append-only Postgres table (`metadata_artifacts`) storing BIM/AIM/CAM by content-hash; query API by `(appId, artifactKind, version)`; content-address integrity checked on read. | ⏳ | _TBD_ |

**WS-1.3 exit:** A published BIM produces, in order, a validated AIM and a validated CAM, all stored immutably; the governance validator returns `passed` for a valid pipeline and `blocked` (with actionable diagnostics) for one deliberately corrupted at any stage.

---

### WS-1.4 Minimal Platform Kernel

Depends on: WS-1.3 (Metadata Registry).

| Task | Estimate | Acceptance Criterion | Status | Owner |
|---|---|---|---|---|
| Artifact resolution (`appId` + `version` → CAM) | 3 d | Kernel reads active-version pointer from the (Phase 1 in-process) Governance Registry; `/version` endpoint returns the loaded CAM's version. | ⏳ | _TBD_ |
| Runtime session lifecycle | 1 wk | `startSession(appId, principal) → sessionId`; session state persisted; graceful shutdown flushes trace events. | ⏳ | _TBD_ |
| In-process event bus | 3 d | Publish/subscribe interface; runtime engines consume/emit `EffectDescriptor` and `TraceEvent`; strict typing per [ADR-013](../adr/ADR-013-runtime-engine-contract.md). | ⏳ | _TBD_ |
| Effect descriptor dispatch | 3 d | Kernel routes each `EffectDescriptor` to the correct technology adapter via `(kind, binding)` per [ADR-014](../adr/ADR-014-technology-adapter-contract.md); unbound effects fail-closed. | ⏳ | _TBD_ |
| OTel trace-context propagation | 3 d | W3C traceparent injected at API boundary; propagated through every engine, adapter, and AI call; visible in the emitted `TraceEvent.traceContext`. | ⏳ | _TBD_ |

**WS-1.4 exit:** The kernel can load Customer Onboarding CAM v0.1 from the Metadata Registry, start a session, dispatch effects, and emit a coherent trace tree consumable by the Trace Viewer.

---

### WS-1.5 Minimal Runtime Engines

Depends on: WS-1.4 (kernel), [ADR-013](../adr/ADR-013-runtime-engine-contract.md).

| Task | Estimate | Acceptance Criterion | Status | Owner |
|---|---|---|---|---|
| UI Runtime | 2 wk | Consumes `InteractionUIModel`; emits render-tree for the seven Phase 1 field types (text, number, select, date, checkbox, textarea, file); conditional visibility driven by RuleModel refs; `execute()` is pure per ADR-013. | ⏳ | _TBD_ |
| Rules Runtime | 1.5 wk | Evaluates the CAM Rule AST v0.1 operators (`and/or/not/eq/neq/lt/lte/gt/gte/in/matches/ref/role-is` + `always/never`); arithmetic deferred to Phase 2; passes conformance suite for the covered operators. | ⏳ | _TBD_ |
| Operations Runtime — 3 mock adapters | 1 wk | `customer.saveDraft:v1` (in-memory), `customer.validateTaxId:v1` (mock always-pass), `document.upload:v1` (local filesystem); each has an Operation Contract and passes it. | ⏳ | _TBD_ |
| Observability Runtime | 1 wk | Emits `event.field.rendered`, `event.rule.fired`, `event.case.*` per the CAM ObservabilityModel; every event validates against `trace-event.v0.1.schema.json`. | ⏳ | _TBD_ |

**WS-1.5 exit:** Every field render, rule fire, and operation call produced by Customer Onboarding is a valid Trace Event, deterministically reproducible from the CAM.

---

### WS-1.6 UI Adapter — React (minimal)

Depends on: WS-1.5 (UI Runtime).

| Task | Estimate | Acceptance Criterion | Status | Owner |
|---|---|---|---|---|
| Render-tree consumer | 1.5 wk | React shell renders the UI Runtime's render-tree for all seven field types; no field type is switched-on in adapter code (extension point only). | ⏳ | _TBD_ |
| Conformance test suite (Tier A UI capabilities) | 1 wk | Test fixtures verify identical render output for identical render-trees; adapter passes suite; suite reusable by future Java UI adapter. | ⏳ | _TBD_ |
| **Zero page-specific business logic** lint rule | 2 d | ESLint rule + CI check that fails the build if any file under `packages/adapter-ui-react/**` imports application-specific identifiers (documented allowlist enforced). | ⏳ | _TBD_ |

**WS-1.6 exit:** The React adapter renders Customer Onboarding end-to-end, and CI proves no business logic has leaked into React code.

---

### WS-1.7 Trace Viewer Tool

Depends on: WS-1.5 (trace event emission).

| Task | Estimate | Acceptance Criterion | Status | Owner |
|---|---|---|---|---|
| Trace ingestion + storage | 1 wk | Trace events land in a queryable store (SQLite for local, Postgres for platform); indexed by `traceId`, `correlationId`, `appId`, `camVersion`, `severity`. | ⏳ | _TBD_ |
| Web UI — trace browser | 2 wk | List view filterable by app version, session, user, event type; detail view shows full envelope including `producedBy` discriminator and `redactions[]`. | ⏳ | _TBD_ |
| "Why did this field appear?" view | 1 wk | Given a `event.field.rendered`, viewer reconstructs the causing chain back through `event.rule.fired` and the CAM InteractionModel ref. Verified against a Customer Onboarding scenario. | ⏳ | _TBD_ |
| "Which rule fired and why?" view | 1 wk | Given a `event.rule.fired`, viewer shows the rule id, matched inputs, actions applied, and the causation chain to the triggering effect. | ⏳ | _TBD_ |
| Deterministic replay | 1 wk | Trace Viewer replays a session's trace events against the pinned CAM version and confirms byte-identical outputs; divergence produces a first-class diagnostic. | ⏳ | _TBD_ |

**WS-1.7 exit:** Every claim in the "Describe → Deploy" demo is provable in the Trace Viewer without opening a database.

---

### WS-1.8 Customer Onboarding Demo v1

Depends on: WS-1.1 through WS-1.7.

| Task | Estimate | Acceptance Criterion | Status | Owner |
|---|---|---|---|---|
| End-to-end integration | 1 wk | Chat → confirm BIM → publish → normalize → generate CAM → activate → open form URL → interact → see traces. All in one session. | ⏳ | _TBD_ |
| Applicant persona happy path | 3 d | Applicant fills every field, satisfies all rules, submits, receives confirmation with correlationId visible in the Trace Viewer. | ⏳ | _TBD_ |
| Country-based conditional field logic | 2 d | Selecting `country: IN` shows the PAN field; selecting `country: US` shows the SSN field; verified by rule-fired trace events. | ⏳ | _TBD_ |
| Recorded demo video | 2 d | Under 15 minutes; shows the full loop; posted to the repo `demos/phase1/` directory with a checksummed source recording. | ⏳ | _TBD_ |

**WS-1.8 exit:** The recorded demo is watchable end-to-end and every claim it makes is inspectable in the running system.

---

## Cross-Cutting Deliverables

| Deliverable | Estimate | Acceptance Criterion | Status | Owner |
|---|---|---|---|---|
| `packages/` scaffolding for the 8 new packages above | 3 d | Each package has `src/index.ts`, `package.json`, `tsconfig.json` extending `tsconfig.base.json`, `build/test/lint/typecheck` scripts. | ⏳ | _TBD_ |
| CI extension for Phase 1 | 3 d | New CI jobs for AI-adapter conformance, UI-adapter conformance, governance-validator smoke, Trace Viewer replay. All required for merge. | ⏳ | _TBD_ |
| Trace Event Kind Registry v0.1 (per-kind payload schemas) | 1 wk | JSON Schema fragments for `event.field.rendered`, `event.rule.fired`, `event.case.submitted`, `event.ai.invoked`, `event.adapter.applied`; each fragment validated against a fixture. | ⏳ | _TBD_ |
| Runbook — local dev in one command | 2 d | `make dev-up` (or pnpm equivalent) brings up Postgres, minio, kernel, chat UI, Trace Viewer, and mounts the Customer Onboarding CAM. Documented in `docs/phase1/runbook.md`. | ⏳ | _TBD_ |

---

## Phase 1 Exit Criteria

Every criterion must be verifiable — no "trust me" items.

- [ ] **Demo works end-to-end** — recorded video shows a business user producing a running application from chat in under 15 minutes.
- [ ] **All AI calls have full provenance** — `AIProvenanceRecord` present for every model invocation; queryable via the AI Provenance Store; missing records refused by kernel (verified by a negative test in CI).
- [ ] **Trace Viewer shows deterministic replay** — replaying the demo's trace against the pinned CAM produces byte-identical outputs.
- [ ] **CI passes for all packages** — build, test, lint, typecheck, conformance suites, schema validation, governance validator smoke.
- [ ] **Governance validator rejects intentionally-broken BIMs correctly** — fixture suite of ≥ 10 negative cases; each returns `blocked` with a specific `failureCode` from the check's declared `failureTaxonomy`.
- [ ] **Zero page-specific React business logic** — enforced by the WS-1.6 lint rule and one manual code-review sign-off.
- [ ] **Air-gapped path works locally** — `aiRouting` swapped to `ai:local-llama`, chat → publish → running form completes with no outbound network calls (verified by a network-block test container).

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| BIM → AIM normalization quality below usable threshold on the first CAM | Prompt-template iteration budget baked into WS-1.3; fall back to guided-form intake for fields the agent can't resolve. |
| Local Llama adapter too slow to make the "15-minute" demo target for air-gapped | Ship the SaaS-Claude demo as the primary video; air-gapped as a secondary "same code, different yaml" clip. Latency budget documented in the adapter manifest. |
| Trace-event volume overwhelms the viewer's storage during long chat sessions | Sampling knob in the Observability Runtime with default 1.0 for demo, tunable per environment; retention policy documented. |
| Scope creep — temptation to add workflow or persistence engines in Phase 1 | Discipline: any work not on this tracker is a Phase 2 candidate. New tasks require an exit-criterion update in this file. |

## References

- [execution-plan.md § Phase 1](../../execution-plan.md#phase-1--ai-intake--minimal-runtime-the-describe--deploy-proof)
- [ADR-013 Runtime Engine Contract](../adr/ADR-013-runtime-engine-contract.md)
- [ADR-014 Technology Adapter Contract](../adr/ADR-014-technology-adapter-contract.md)
- [ADR-015 AI Model Adapter Layer](../adr/ADR-015-ai-model-adapter-layer.md)
- [ADR-016 Deployment Packaging](../adr/ADR-016-deployment-packaging.md)
- [ADR-017 Governance Publication Gate](../adr/ADR-017-governance-publication-gate.md)
- [Phase 0 tracker](../phase0/README.md)
