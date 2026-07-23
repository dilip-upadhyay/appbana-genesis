# Phase 0 — Foundation & Alignment

This is the live tracker for Phase 0. See [execution-plan.md](../../execution-plan.md) for the full plan.

**Duration target:** 4–6 weeks
**Team:** 3–5 people (architect, senior engineer, AI/ML engineer, product lead)

## Workstream Status

### WS-0.1 Architecture Decision Records

| ADR | Status | Owner |
|---|---|---|
| [ADR-011 BIM vs AIM boundary](../adr/ADR-011-bim-aim-boundary.md) | ✅ Accepted | Dilip |
| [ADR-012 CAM versioning](../adr/ADR-012-canonical-application-model-versioning.md) | ⏳ Proposed | _TBD_ |
| [ADR-013 Runtime engine contract](../adr/ADR-013-runtime-engine-contract.md) | ⏳ Proposed | _TBD_ |
| [ADR-014 Technology adapter contract](../adr/ADR-014-technology-adapter-contract.md) | ⏳ Proposed | _TBD_ |
| [ADR-015 AI model adapter layer](../adr/ADR-015-ai-model-adapter-layer.md) | ⏳ Proposed | _TBD_ |
| [ADR-016 Deployment packaging](../adr/ADR-016-deployment-packaging.md) | ⏳ Proposed | _TBD_ |
| [ADR-017 Governance publication gate](../adr/ADR-017-governance-publication-gate.md) | ⏳ Proposed | _TBD_ |

### WS-0.2 Schema Definitions

| Schema | Status | Owner |
|---|---|---|
| [BIM v0.1](../schemas/bim.v0.1.schema.json) | ✅ v0.1 published (validated against Customer Onboarding reference) | Dilip |
| [AIM v0.1](../schemas/aim.v0.1.schema.json) | ✅ v0.1 published (validated against Customer Onboarding reference) | Dilip |
| CAM v0.1 (10 sub-models) | ⏳ Not started | _TBD_ |
| Operation Contract v0.1 | ⏳ Not started | _TBD_ |
| Trace Event v0.1 | ⏳ Not started | _TBD_ |

### WS-0.3 Repository Scaffolding

- [x] Monorepo layout (`pnpm-workspace.yaml`, `package.json`)
- [x] Baseline TypeScript config (`tsconfig.base.json`)
- [x] `.gitignore`, `.editorconfig`, `.nvmrc`
- [x] CI skeleton (`.github/workflows/ci.yml`)
- [x] CODEOWNERS and PR template
- [x] Schema validator tool + CI job ([tools/validate-schemas](../../tools/validate-schemas/))
- [ ] Package placeholders under `packages/` (populate as ADRs land)
- [ ] Container image build pipeline
- [ ] Documentation site (Docusaurus or alternative)

### WS-0.4 Reference Scenario Specification (Customer Onboarding)

- [x] BIM v0.1 hand-authored — [examples/customer-onboarding/bim.json](../../examples/customer-onboarding/bim.json)
- [x] AIM v0.1 hand-authored — [examples/customer-onboarding/aim.json](../../examples/customer-onboarding/aim.json) (schema pending)
- [ ] CAM v0.1 hand-authored — `examples/customer-onboarding/cam.json`
- [ ] Round-trip validation script

### WS-0.5 Tech Stack Decisions

- [x] Language: TypeScript / Node 22 LTS
- [x] Package manager: pnpm 10.x
- [ ] AI orchestration: **spike** — LangGraph vs custom
- [ ] Persistence for Phase 1: PostgreSQL (platform) + SQLite (demo apps) — confirm in ADR
- [ ] Documentation site tool
- [ ] Container / build pipeline (Docker + BuildKit assumed)

### WS-0.6 Team & Ops Setup

- [ ] GitHub org / access model finalized
- [ ] Branching model documented
- [ ] Security baseline (Dependabot, secret scanning, SBOM)
- [ ] Coding standards + PR review protocol

## Phase 0 Exit Criteria

- [ ] All 7 ADRs (011–017) approved
- [ ] All 5 schemas v0.1 published
- [ ] Repo scaffold builds and CI is green
- [ ] Customer Onboarding reference artifacts validate cleanly
- [ ] Phase 1 backlog is executable (each task has acceptance criteria and estimate)
