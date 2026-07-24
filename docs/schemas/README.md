# Schemas

This directory contains versioned JSON Schemas for every canonical artifact in AppBana Genesis.

## Catalog

| Schema | File | Version | Status |
|---|---|---|---|
| Business Intent Model | [bim.v0.1.schema.json](bim.v0.1.schema.json) | v0.1 | ✅ Published (validated against [examples/customer-onboarding/bim.json](../../examples/customer-onboarding/bim.json)) |
| Application Intent Model | [aim.v0.1.schema.json](aim.v0.1.schema.json) | v0.1 | ✅ Published (validated against [examples/customer-onboarding/aim.json](../../examples/customer-onboarding/aim.json)) |
| Canonical Application Model | [cam.v0.1.schema.json](cam.v0.1.schema.json) | v0.1 | ✅ Published (validated against [examples/customer-onboarding/cam.json](../../examples/customer-onboarding/cam.json)) |
| Operation Contract | [operation-contract.v0.1.schema.json](operation-contract.v0.1.schema.json) | v0.1 | ✅ Published (validated against [examples/customer-onboarding/operation-contracts/customer.submit-onboarding.v1.json](../../examples/customer-onboarding/operation-contracts/customer.submit-onboarding.v1.json)) |
| Trace Event | [trace-event.v0.1.schema.json](trace-event.v0.1.schema.json) | v0.1 | ✅ Published (validated against 3 fixtures in [examples/customer-onboarding/trace-events/](../../examples/customer-onboarding/trace-events/)) |
| AI Adapter Manifest | [ai-adapter-manifest.v0.1.schema.json](ai-adapter-manifest.v0.1.schema.json) | v0.1 | ✅ Published (validated against 2 reference-adapter manifests in [examples/customer-onboarding/ai-adapter-manifests/](../../examples/customer-onboarding/ai-adapter-manifests/)) |

## Rules

- Every schema declares `$id` including its semantic version (e.g., `https://schemas.appbana.dev/bim/v0.1`).
- Breaking changes require a major-version bump and a migration entry.
- Every schema must be validated in CI against the Customer Onboarding reference artifacts under [`examples/customer-onboarding/`](../../examples/customer-onboarding/).
- Schemas are the source of truth. Generated TypeScript / Java / Python types must be produced from these schemas, never the other way around.

## References

- [ADR-011 — BIM vs AIM Boundary](../adr/ADR-011-bim-aim-boundary.md)
- [ADR-012 — CAM Versioning Strategy](../adr/ADR-012-canonical-application-model-versioning.md)
- [ADR-013 — Runtime Engine Contract](../adr/ADR-013-runtime-engine-contract.md)
- [ADR-014 — Technology Adapter Contract & Conformance](../adr/ADR-014-technology-adapter-contract.md)
- [ADR-015 — AI Model Adapter Layer & Provenance](../adr/ADR-015-ai-model-adapter-layer.md)
- [ADR-016 — Deployment Packaging (Kubernetes-first)](../adr/ADR-016-deployment-packaging.md)
- [ADR-017 — Governance Publication Gate & Rollback](../adr/ADR-017-governance-publication-gate.md)
- [architecture.md § 9 — Canonical Application Model](../../architecture.md)
