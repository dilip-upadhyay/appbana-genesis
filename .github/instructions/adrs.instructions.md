---
description: "Use when writing, reviewing, or updating Architecture Decision Records. Covers MADR format, ADR numbering (ADR-011+), status lifecycle, when to open a new ADR vs update existing, and the approval process."
applyTo: "docs/adr/**"
---

# ADR Authoring Instructions

## Format

Use the MADR (Markdown Architectural Decision Records) style. Template: `docs/adr/0000-template.md`.

Required sections:
- **Status** — Proposed / Accepted / Deprecated / Superseded by ADR-XXX
- **Date** — ISO date when written
- **Deciders** — names of people who approved
- **Context and Problem Statement** — what forces are at play
- **Decision Drivers** — what we optimized for
- **Considered Options** — all options evaluated (minimum 2, ideally 3)
- **Decision** — chosen option with one-paragraph justification
- **Consequences** — positive, negative, neutral
- **Compliance / Validation** — how we know the decision is being honored

Optional but encouraged:
- **Consulted** / **Informed**
- **References** — links to architecture.md sections, execution-plan.md phases, related ADRs

## Numbering

- ADR-001 through ADR-010: reserved for pre-Genesis decisions (may be back-filled or left as stubs).
- New decisions start at ADR-011.
- Do not skip numbers. If a decision is withdrawn before acceptance, mark it Deprecated rather than deleting.

## Status Lifecycle

```
Proposed → Accepted (after approval)
         → Deprecated (if superseded or abandoned)
Accepted → Superseded by ADR-XXX (if a newer ADR replaces it)
```

Never delete an ADR. Traceability of why decisions were made is permanent.

## When to Write a New ADR

Write a new ADR when:
- A locked decision needs to be revisited (write the new ADR first, get it accepted, then update the old one to "Superseded by ADR-NNN").
- A significant new architectural choice is made (new runtime engine, new adapter category, new deployment mode, new AI orchestration approach).
- An open question from `architecture.md § 23` is resolved.
- A technology spike concludes (e.g., LangGraph vs custom orchestrator spike → ADR-018).

Do NOT write an ADR for:
- Implementation details of a single package.
- Choice of a library version (use package.json + a comment).
- Decisions that are already implied by an existing accepted ADR.

## Approval Process

1. Copy `docs/adr/0000-template.md` → `docs/adr/ADR-NNN-short-title.md`.
2. Set status to **Proposed**, fill all required sections.
3. Open a PR targeting `main` with the label `adr`.
4. At least one other person (or Copilot on behalf of the architecture record) reviews the decision drivers and considered options.
5. On approval, set status to **Accepted**, update the ADR index in `docs/adr/README.md`, and update `docs/phase0/README.md` (or relevant phase tracker) if it was a tracked workstream item.

## Currently Open ADRs (fill these in Phase 0 workshops)

| ADR | Key question to answer |
|---|---|
| ADR-012 | Semver at CAM level vs per-sub-model vs content-addressable? |
| ADR-013 | Full runtime engine contract interface (inputs, outputs, effects, events, failure modes) |
| ADR-014 | Adapter capability tier definitions and conformance certification protocol |
| ADR-015 | `AIModelAdapter` interface + `AgentPromptContract` + provenance schema (align with ai-agents.instructions.md) |
| ADR-016 | Helm chart structure, Operator CRDs (`GenesisApplication`, `GenesisTenant`, `GenesisAdapter`), offline bundle format |
| ADR-017 | All 10 governance gate checks formally defined with pass/fail criteria + rollback protocol |

## Locked ADR (do not re-open without a superseding ADR)

- **ADR-011** (BIM ↔ AIM boundary) — Accepted. The two-model hard boundary, AI-only bridge, diffable/reversible translation. See [ADR-011](ADR-011-bim-aim-boundary.md).

## References

- [docs/adr/README.md](README.md) — ADR index
- [architecture.md § 23 — Open Architecture Questions](../../architecture.md)
- [execution-plan.md — Phase 0 WS-0.1](../../execution-plan.md)
