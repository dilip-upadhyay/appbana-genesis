# ADR-012: Canonical Application Model Versioning Strategy

- **Status:** Proposed
- **Date:** 2026-07-19
- **Deciders:** _TBD_
- **Consulted:** Platform Kernel team, Migration Engine team

## Context and Problem Statement

The Canonical Application Model (CAM) is the central execution artifact consumed by every runtime engine and technology adapter. As the platform evolves, the CAM schema will change: sub-models will be added, fields renamed, semantics tightened. Without a disciplined versioning strategy, generated applications will silently break on platform upgrades.

## Decision Drivers

- Deterministic execution requires an unambiguous artifact + version pointer at all times.
- Migration Engine must be able to lift older CAM artifacts to a newer schema without losing business intent.
- Multi-tenant deployments will run multiple CAM versions concurrently.
- Rollback must always be able to restore a previous CAM artifact bit-for-bit.

## Considered Options

_To be developed during Phase 0 ADR workshop._

1. **Strict semver** at the top level of the CAM.
2. **Semver per sub-model** (UI model v0.3, Workflow model v0.1, etc.).
3. **Content-addressable artifacts** with schema version + migration graph.

## Decision

_Pending._

## Consequences

_Pending._

## References

- [architecture.md § 9 — Canonical Application Model](../../architecture.md)
- [architecture.md § 13 — Migration Engine](../../architecture.md)
- [ADR-011](ADR-011-bim-aim-boundary.md)
