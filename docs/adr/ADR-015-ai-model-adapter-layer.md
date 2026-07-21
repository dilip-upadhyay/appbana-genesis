# ADR-015: AI Model Adapter Layer & Provenance

- **Status:** Proposed
- **Date:** 2026-07-19
- **Deciders:** _TBD_
- **Consulted:** AI Agent team, Governance team, Security team

## Context and Problem Statement

AppBana Genesis relies on AI models for the BA agent, domain modeler, validation agent, and future intake agents. Hard-wiring to a single model provider would kill enterprise deals (data residency, licensing, air-gapped constraints). Additionally, every AI-generated artifact must carry provenance to satisfy the governance publication gate.

## Decision Drivers

- Enterprise customers demand model choice (Azure OpenAI, Anthropic, AWS Bedrock, Google Vertex, on-prem Llama, NVIDIA NIM).
- Air-gapped deployments must work with local models (Llama 3.3 70B, Qwen).
- Every AI call must produce a provenance record (model, version, prompt template, hash, tokens).
- Prompt templates must be versioned as first-class artifacts.
- Different agents may use different models optimized for their task profile.

## Considered Options

_To be developed during Phase 0 ADR workshop._

## Decision

_Pending. Must define:_

- `AgentPromptContract` interface (role, task, input schema, output schema, tools, budget, determinism)
- `AIModelAdapter` interface (translate contract → model-native call)
- Provenance record schema (model, prompt template, hashes, tokens, timestamp, human reviewer)
- Default cloud vs on-prem model assignments per agent
- Prompt template registry versioning

## Consequences

_Pending._

## References

- [architecture.md § 7 — AI Application Agent](../../architecture.md)
- [architecture.md § 17 — AI Governance Architecture](../../architecture.md)
- [execution-plan.md — Phase 1 WS-1.2](../../execution-plan.md)
