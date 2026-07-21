# Architecture Decision Records (ADRs)

This directory contains the Architecture Decision Records for AppBana Genesis.

## Format

We use a lightweight [MADR](https://adr.github.io/madr/)-style format. See [`0000-template.md`](0000-template.md).

## Status Lifecycle

- **Proposed** — under discussion
- **Accepted** — approved and in force
- **Deprecated** — no longer recommended but not superseded
- **Superseded by ADR-XXX** — replaced by a newer decision

## Index

| ID | Title | Status |
|---|---|---|
| [ADR-011](ADR-011-bim-aim-boundary.md) | Business Intent Model vs Application Intent Model Boundary | Accepted |
| [ADR-012](ADR-012-canonical-application-model-versioning.md) | Canonical Application Model Versioning Strategy | Proposed |
| [ADR-013](ADR-013-runtime-engine-contract.md) | Runtime Engine Contract & Lifecycle | Proposed |
| [ADR-014](ADR-014-technology-adapter-contract.md) | Technology Adapter Contract & Conformance | Proposed |
| [ADR-015](ADR-015-ai-model-adapter-layer.md) | AI Model Adapter Layer & Provenance | Proposed |
| [ADR-016](ADR-016-deployment-packaging.md) | Deployment Packaging (Kubernetes-first) | Proposed |
| [ADR-017](ADR-017-governance-publication-gate.md) | Governance Publication Gate & Rollback | Proposed |

> ADR-001 through ADR-010 are reserved for earlier decisions from the pre-Genesis interaction-runtime phase and will be back-filled or marked as superseded.

## Authoring a New ADR

1. Copy `0000-template.md` to `ADR-NNN-short-title.md`.
2. Set status to **Proposed** and fill in Context, Decision, Consequences.
3. Open a PR with the `docs/adr/` change and request architecture review.
4. On approval, flip status to **Accepted** and update this index.
