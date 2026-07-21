# Schemas

This directory contains versioned JSON Schemas for every canonical artifact in AppBana Genesis.

## Catalog

| Schema | File | Version | Status |
|---|---|---|---|
| Business Intent Model | `business-intent-model.schema.json` | v0.1 | Not started (WS-0.2) |
| Application Intent Model | `application-intent-model.schema.json` | v0.1 | Not started (WS-0.2) |
| Canonical Application Model | `canonical-application-model.schema.json` | v0.1 | Not started (WS-0.2) |
| Operation Contract | `operation-contract.schema.json` | v0.1 | Not started (WS-0.2) |
| Trace Event | `trace-event.schema.json` | v0.1 | Not started (WS-0.2) |

## Rules

- Every schema declares `$id` including its semantic version (e.g., `https://schemas.appbana.dev/bim/v0.1`).
- Breaking changes require a major-version bump and a migration entry.
- Every schema must be validated in CI against the Customer Onboarding reference artifacts under [`examples/customer-onboarding/`](../../examples/customer-onboarding/).
- Schemas are the source of truth. Generated TypeScript / Java / Python types must be produced from these schemas, never the other way around.

## References

- [ADR-011 — BIM vs AIM Boundary](../adr/ADR-011-bim-aim-boundary.md)
- [ADR-012 — CAM Versioning Strategy](../adr/ADR-012-canonical-application-model-versioning.md)
- [architecture.md § 9 — Canonical Application Model](../../architecture.md)
