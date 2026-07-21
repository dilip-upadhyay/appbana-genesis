# ADR-017: Governance Publication Gate & Rollback

- **Status:** Proposed
- **Date:** 2026-07-19
- **Deciders:** _TBD_
- **Consulted:** Governance team, Security team, Compliance team

## Context and Problem Statement

No application artifact should be activated in production without passing all governance checks. AI-generated changes especially must be diffed, previewed, approved, and reversible. Rollback must always restore the exact previous artifact bit-for-bit.

## Decision Drivers

- Enterprise applications require SOX-grade audit and reversibility.
- AI-generated patches must never bypass human approval.
- Rollback must be atomic and near-instantaneous.
- Every gate check must produce a machine-readable report.

## Considered Options

_To be developed during Phase 0 ADR workshop._

## Decision

_Pending. Must define the 10 mandatory gate checks:_

1. Schema validation
2. Security validation
3. Privacy validation
4. Accessibility validation
5. Operation contract validation
6. Runtime compatibility validation
7. Adapter capability validation
8. Performance budget validation
9. AI governance validation (if AI-generated)
10. Human approval and rollback readiness

_And the rollback protocol: immutable artifact registry, active-version pointer, atomic pointer swap, provenance chain preservation._

## Consequences

_Pending._

## References

- [architecture.md § 8 — Governance and Validation Plane](../../architecture.md)
- [architecture.md § 17 — AI Governance Architecture](../../architecture.md)
