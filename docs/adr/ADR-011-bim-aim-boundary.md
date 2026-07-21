# ADR-011: Business Intent Model vs Application Intent Model Boundary

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** Dilip
- **Consulted:** Architecture team, AI/ML lead, Product lead
- **Informed:** All Phase 0 and Phase 1 workstreams

## Context and Problem Statement

AppBana Genesis converts business intent into governed, running enterprise applications through a multi-stage pipeline. Two distinct model layers exist between the user and the executable Canonical Application Model (CAM):

- **Business Intent Model (BIM)** — what the business *wants*
- **Application Intent Model (AIM)** — what the platform *will build*

Open Question #1 in [architecture.md](../../architecture.md) explicitly flags the boundary between BIM and AIM as unresolved. Without a hard boundary, we risk:

- AI agents leaking implementation choices into business artifacts (making BIMs unstable and un-authorable by humans).
- Runtime engines consuming ambiguous or partial input (breaking the deterministic-execution principle).
- Duplicated concerns across both models (making migration and versioning fragile).
- No clear place for human review vs. AI-only translation.

## Decision Drivers

- **Business intent must survive technology change** (core thesis of the platform).
- Business users must be able to *author and understand* the BIM without any technical vocabulary.
- Runtime engines must consume a *fully resolved, deterministic* AIM — no interpretation of ambiguity at runtime.
- AI translation between the two must be **diffable, explainable, and reversible**.
- Both models must be independently versioned so translation logic can evolve without breaking either layer.
- Regeneration safety: rephrasing the BIM must not silently change AIM structure without a diff.

## Considered Options

1. **Single unified intent model.** One document covers business language and platform structure. **Rejected** — collapses two very different levels of abstraction and forces business users to see technical concepts.
2. **BIM is a conversation transcript; AIM is the real model.** **Rejected** — makes the BIM un-versionable and hides business intent from audit.
3. **Hard two-model boundary with AI as the only bridge.** **Chosen.**
4. **Three-layer split (BIM → Intermediate Requirements Doc → AIM).** **Rejected** — adds a layer without clear ownership; the "requirements doc" would collapse into either BIM or AIM in practice.

## Decision

Adopt a **hard two-model boundary** with the following contract:

| Aspect | Business Intent Model (BIM) | Application Intent Model (AIM) |
|---|---|---|
| **Vocabulary** | Business terms ("customer", "onboard", "high-risk") | Platform terms (`Entity`, `Operation`, `Rule`, `StateTransition`) |
| **Ambiguity** | Allowed and expected — captured with clarification | Zero ambiguity — every reference must resolve |
| **Completeness** | Partial and iterative — BA agent fills gaps | Complete and validated — schema-conformant |
| **Author** | Business user (via AI agent conversation) | AI agent + platform normalizer |
| **Versioning** | Change history + rationale | Semver + migration path |
| **Language style** | "Approvers should see high-risk applications first" | `Rule[id=display-order, condition=riskScore>7, action=setSortPriority(1)]` |
| **Persona** | Named as user ("Bank Officer", "Compliance Reviewer") | Mapped to canonical roles (`role.reviewer`, `role.approver`) |
| **Entities** | Names + attributes in business language | Typed `Entity` with fields, classifications, relationships, keys |
| **Workflow** | Prose or timeline ("after approval, notify the customer") | Explicit `StateMachine` with states, guards, transitions, effects |
| **Rules** | Business policy ("Indian customers need GST") | `Rule[when: country==IN && customerType==business, then: require(field=gstNumber)]` |
| **Operations** | Verbs ("submit", "review", "escalate") | Semantic operations with input/output/auth/idempotency contracts |
| **Non-functional** | "Should be fast", "Must be secure" | Resolved to performance budgets, security policies, SLAs |
| **Persisted as** | JSON document + attached transcripts/media | JSON document conformant to AIM JSON Schema |
| **Consumed by** | Governance UI, AI agents, human reviewers | Canonical generator only |

### The Transformation Contract

```text
BIM (partial, ambiguous, business-language)
    ↓
    [Clarification Agent] — asks user to resolve gaps
    ↓
BIM (complete, business-language)
    ↓
    [Normalization Agent] — maps business terms → canonical types
    ↓
    [Resolution Agent] — resolves references, defaults, inheritance
    ↓
    [Validation Agent] — enforces AIM schema
    ↓
AIM (complete, canonical, schema-conformant, deterministic)
    ↓
    [Canonical Generator] — pure function, no AI
    ↓
CAM (execution-ready, versioned, immutable)
```

### The Golden Rule

> **The BIM is the only artifact a business user ever edits. The AIM is the only artifact the platform kernel ever reads. The AI agent is the only thing that translates between them — and every translation is diffable, explainable, and reversible.**

### Ownership Boundaries

- **BIM schema** owned by Product + Architecture.
- **AIM schema** owned by Architecture.
- **BIM → AIM translation** owned by AI Agent team.
- **AIM → CAM generation** owned by Platform Kernel team (must be deterministic, no AI).

## Consequences

**Positive:**

- Business users can author and audit BIMs without any technical training.
- Runtime engines can rely on a fully resolved, schema-conformant AIM — no interpretation at runtime.
- AI translation quality can be improved (model swaps, prompt updates) without changing the BIM or the CAM.
- Multi-locale support: one AIM can back multiple localized BIMs (English, French, Japanese).
- Governance audit splits cleanly: intent changes (BIM) vs. structural changes (AIM).
- Power users retain an escape hatch — they may edit AIM directly (like Salesforce metadata XML) for cases the AI cannot express.

**Negative / Costs:**

- Requires maintaining two schemas, two validators, and a translation pipeline.
- Translation errors ("the AI misunderstood") become a distinct class of bug that needs its own eval framework.
- Regeneration of AIM from a modified BIM must be diffed against the previous AIM to prevent silent structural drift.

**Neutral:**

- Adds a formal Normalization/Resolution/Validation stage but this is aligned with the "Canonical application model" principle already in [architecture.md](../../architecture.md).

## Compliance / Validation

- **Schema validators** in `docs/schemas/` enforce both BIM and AIM structure in CI.
- **Reference artifact test** (WS-0.4): the hand-authored Customer Onboarding BIM must produce the hand-authored Customer Onboarding AIM through the translation pipeline, byte-comparable modulo timestamps.
- **Round-trip regeneration test**: any BIM must produce the same AIM on 100 consecutive runs (deterministic when translation model + prompt are pinned).
- **Governance UI** must display BIM and AIM side-by-side with diff highlighting whenever an AI-generated patch is proposed.
- **Escape hatch policy**: direct AIM edits are allowed, but each edit must record a "BIM-regenerated-from-AIM" round-trip check to prevent divergence.

## References

- [architecture.md § 6 — Business Intent Model](../../architecture.md)
- [architecture.md § 9 — Canonical Application Model](../../architecture.md)
- [architecture.md § 23 — Open Architecture Questions (Q1)](../../architecture.md)
- [execution-plan.md — Phase 0 WS-0.1, WS-0.2, WS-0.4](../../execution-plan.md)
