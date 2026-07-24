# @appbana/adapter-ai-contract

The AI Model Adapter contract for AppBana Genesis. This package is the single dependency every AI adapter package and every agent package shares.

- **Scope:** types + runtime tags only. No I/O, no model calls, no dependencies beyond TypeScript.
- **Authority:** [ADR-015 — AI Model Adapter Layer & Provenance](../../docs/adr/ADR-015-ai-model-adapter-layer.md). Every symbol in this package traces to a section of that ADR.
- **Contract version:** `AI_ADAPTER_CONTRACT_VERSION = "0.1.0"` — bumps follow semver.

## Layout

| File | ADR-015 § | Exports |
|---|---|---|
| [`src/adapter.ts`](src/adapter.ts) | *The `AIModelAdapter` Interface* | `AIModelAdapter`, `AIAdapterInvocationOutcome`, `AIInvocationResult`, `AIInvocationChunk` |
| [`src/capabilities.ts`](src/capabilities.ts) | *The Five AI Adapter Kinds* + *Capability Declaration* | `AICapabilityKind`, `aiCapabilityKinds`, `AIResponseContractKind`, `AIConformanceTier`, `AIAdapterCapabilities` |
| [`src/invocation.ts`](src/invocation.ts) | *The `AIModelAdapter` Interface* + *Budgets, Rate Limits, and Back-Pressure* | `AIInvocationRequest`, `AIInvocationContext`, `AIResponseContract`, `AIBudget`, `AIRequestingAgent` |
| [`src/provenance.ts`](src/provenance.ts) | *Provenance Record — Mandatory on Every Call* | `AIProvenanceRecord`, `AIProvenanceRedaction`, `AIProvenanceHumanReview`, `AI_PROVENANCE_VERSION` |
| [`src/config.ts`](src/config.ts) | *Discovery and Binding* | `AIAdapterConfig`, `AIAdapterInitContext` |
| [`src/health.ts`](src/health.ts) | *The `AIModelAdapter` Interface* | `AIAdapterHealth`, `AIAdapterHealthState` |
| [`src/diagnostic.ts`](src/diagnostic.ts) | Shared with ADR-013 | `Diagnostic`, `DiagnosticSeverity` |

## Downstream consumers (Phase 1)

- `@appbana/adapter-ai-anthropic-claude` — cloud text-generation + structured-output reference adapter (WS-1.2).
- `@appbana/adapter-ai-local-llama` — air-gapped text-generation + structured-output reference adapter (WS-1.2).
- `@appbana/ai-application-agent` — BA Agent, Normalization Agent, CAM Generator (WS-1.1, WS-1.3).
- `@appbana/ai-adapter-conformance-suite` — shared test runner every AI adapter must pass (WS-1.2).
- `@appbana/platform-kernel` — resolves the `aiRouting` map into adapter instances, persists provenance, enforces budgets (WS-1.4).

## Non-goals

- **No prompt template implementation.** Prompt templates live in `packages/ai-application-agent/prompts/**` per ADR-015 § *Prompt Template Registry*. This package only exposes the ref/version/hash fields that agents fill in.
- **No adapter manifest schema.** That is a separate follow-up (AI Adapter Manifest v0.1, ADR-015 follow-ups) and belongs alongside the reference adapters.
- **No provenance storage.** The AI Provenance Store lives in the kernel (WS-1.2 task). This package only defines the record shape.
