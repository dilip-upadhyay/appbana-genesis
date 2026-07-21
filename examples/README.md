# Examples — Reference Scenarios

Hand-authored reference metadata artifacts used by every Phase 0 validator and every downstream Phase 1+ runtime.

## Scenarios

| Scenario | Folder | Purpose | Phase |
|---|---|---|---|
| Customer Onboarding | [`customer-onboarding/`](customer-onboarding/) | First vertical slice. Proves UI + workflow + rules + AI intake. | Phase 0 (spec) / Phase 1 (demo) |
| Expense Approval | _TBD_ | Second vertical slice. Proves generality — delegation, routing, real integration, mobile. | Phase 3 |
| Insurance Claim Intake | _TBD_ | Third vertical slice. Proves long-running processes, document AI, external enrichment. | Phase 4 |

## Rules

- Every scenario must exist as a **BIM**, an **AIM**, and a **CAM** artifact.
- The three artifacts must round-trip through the translation pipeline without loss (per [ADR-011](../docs/adr/ADR-011-bim-aim-boundary.md)).
- These files are the CI smoke-test fixtures for all schema validators.
