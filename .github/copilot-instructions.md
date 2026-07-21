# AppBana Genesis — Copilot Instructions

## What This Project Is

AppBana Genesis is an AI-native enterprise application creation platform. Business users describe intent in natural language; the platform produces governed, versioned, runnable enterprise applications — without writing code.

**Core thesis:** Business intent should survive technology change.

**Pipeline:**
```
Business User → BA Agent → BIM → Normalization Agent → AIM → CAM Generator → Platform Kernel → Runtime Engines → Adapters → Running Enterprise App
```

**Target market:** Small banks and financial institutions now → large complex enterprises in future. Every design decision must hold at both scales.

## Essential Reading (read before any significant work)

- [architecture.md](../architecture.md) — baseline architecture v1.0, canonical reference
- [execution-plan.md](../execution-plan.md) — phase-wise plan (Phase 0–6) with exit criteria
- [docs/phase0/README.md](../docs/phase0/README.md) — current phase live tracker (update checkboxes as work completes)
- [docs/adr/README.md](../docs/adr/README.md) — all architectural decisions index
- [docs/schemas/README.md](../docs/schemas/README.md) — canonical schema catalog
- [examples/customer-onboarding/README.md](../examples/customer-onboarding/README.md) — first vertical slice reference

## Locked Decisions — Never Reverse Without a New ADR

1. **BIM ↔ AIM boundary** — BIM = business-language, human-editable, ambiguous OK. AIM = canonical, schema-conformant, zero ambiguity. AI agent is the **only** bridge. Every translation is diffable, explainable, reversible. → [ADR-011](../docs/adr/ADR-011-bim-aim-boundary.md)
2. **Kubernetes-first deployment** — Helm + Operator + OCI + offline installer. Three modes: SaaS multi-tenant, dedicated cloud, air-gapped on-prem. → ADR-016
3. **Multi-model AI adapter** — Cloud: Claude Sonnet 4.5 + GPT-4o. On-prem: Llama 3.3 70B + Whisper. Full provenance on every AI call. Models are swappable without changing agent logic. → ADR-015
4. **Vertical slice order** — #1 Customer Onboarding, #2 Expense Approval, #3 Insurance Claim Intake. Do not skip or reorder.
5. **CAM is the only kernel input** — Runtime engines never consume BIM or AIM directly.
6. **Zero business logic in frontend** — React adapter is a pure metadata renderer. No page-specific rules in React. All logic lives in CAM + runtime engines.
7. **Every phase ends with a runnable demo** — not a document. Each phase ships the previous demo plus one new capability. No regressions.
8. **Trace Viewer is a first-class deliverable from Phase 1** — not deferred. It is the credibility proof.

## Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Language (primary) | TypeScript / Node.js 22 LTS | All platform packages and runtime engines |
| Package manager | pnpm 10.x | Workspace monorepo |
| TypeScript base | `tsconfig.base.json` | All packages extend this |
| Platform persistence | PostgreSQL | Metadata registry, governance, tenants |
| Demo persistence | SQLite | Zero-infra local/demo |
| Object storage | MinIO (local) / S3-compatible (cloud) | Document uploads |
| Identity / Auth | Keycloak + OIDC adapter | Bring-your-own in enterprise |
| Message bus | Kafka | Phase 4+ integration runtime |
| Observability | OpenTelemetry → Jaeger / Prometheus | From day one |
| AI orchestration | LangGraph or custom (spike pending) | Decision by end of Phase 0 |
| Chat UI | Next.js + shadcn/ui | BA agent conversational intake |
| UI renderer | React (plain, not Next.js) | Renders CAM — no business logic |
| Containers | Docker + BuildKit | Per-package OCI images |
| K8s local dev | kind | |
| K8s edge | k3s | |
| K8s production | Standard K8s (AKS/EKS/GKE) | |
| Generated app (Java) | Spring Boot | Phase 4 adapter — for Java-mandate enterprises |
| Future kernel hot paths | Rust / Go (reserved) | Rules engine + workflow engine if Node.js hits limits |

## Repository Layout

```
packages/          # Platform packages — kernel, runtimes, adapters, schemas
apps/              # End-to-end demo applications
examples/          # Reference scenario artifacts (BIM / AIM / CAM)
tools/             # CLIs: validator, trace-viewer, migration-runner
docs/adr/          # Architecture Decision Records (ADR-011+)
docs/schemas/      # JSON Schemas (BIM, AIM, CAM, Operation, Trace)
docs/phase0/       # Phase 0 live tracker
.github/           # CI, CODEOWNERS, PR template, Copilot instructions
```

## Package Conventions

- Scope: `@appbana/<package-name>` for all packages.
- Public API through `src/index.ts` only — no deep imports.
- Every package declares `build`, `test`, `lint`, `typecheck` scripts.
- `tsconfig.json` in each package extends `../../tsconfig.base.json`.
- **Schemas are the source of truth.** TypeScript types are generated from JSON Schemas — never the other way round.
- ADR numbering: 001–010 reserved for pre-Genesis history. New decisions at ADR-011+.
- New ADR: copy `docs/adr/0000-template.md`, set status Proposed, open PR.

## Build & Test Commands

```powershell
pnpm install         # install all workspace deps
pnpm build           # build all packages (recursive)
pnpm test            # test all packages
pnpm lint            # lint all packages
pnpm typecheck       # type-check all packages
pnpm clean           # remove all dist/ and node_modules
```

CI runs on every PR via `.github/workflows/ci.yml`. Must be green before merging.

## AI & Provenance Rules (mandatory on every AI call)

Every AI call must record: model name, model version, prompt template ID + version, input hash, output hash, token count, timestamp, human reviewer (if applicable). Prompt templates are versioned in `packages/ai-application-agent/prompts/`. Never hard-code a model name in agent logic — always route through the AI model adapter interface.

## Governance Publication Gate (all 10 checks mandatory)

No CAM version activates in production without passing:
1. Schema validation
2. Security validation
3. Privacy validation
4. Accessibility validation
5. Operation contract validation
6. Runtime compatibility validation
7. Adapter capability validation
8. Performance budget validation
9. AI governance validation (AI-generated changes only)
10. Human approval + rollback readiness

## Observability — From Day One

- Every field render, rule fire, and operation call emits a structured trace event.
- Trace Event Schema: `docs/schemas/trace-event.schema.json`.
- Trace Viewer must answer: "why did this field appear?" and "why did this rule fire?"
- OTel context propagates across all runtime engines, not just at the API boundary.

## Security Baseline

- No secrets in source. Use environment variables or Kubernetes Secrets.
- Dependabot enabled; dependency update PRs merged within one week.
- SBOM generated on every release build.
- OWASP Top 10 reviewed before each phase goes to production.
- Field-level ABAC enforced in the Security/Policy Runtime — not duplicated in adapters.
- Input validated at system boundaries (API entry points). Do not add defensive checks inside the deterministic execution path.

## Phase Status — Update This When Phases Advance

| Phase | Status | Key Deliverable |
|---|---|---|
| Phase 0 — Foundation | 🟡 In Progress | ADRs locked, schemas published, CI green, Customer Onboarding reference artifacts validated |
| Phase 1 — AI Intake + Minimal Runtime | ⏳ Not started | Chat → running form in <15 min, zero page-specific code |
| Phase 2 — Full Application Slice | ⏳ Not started | Customer Onboarding as full enterprise app, 100 concurrent users |
| Phase 3 — Multi-modal + Expense Approval | ⏳ Not started | Expense Approval with zero platform code changes |
| Phase 4 — Integration + Java Adapter | ⏳ Not started | Same CAM → Node.js and Java deployments, identical behavior |
| Phase 5 — Deployment & On-Premises | ⏳ Not started | Air-gapped install, identical across 3 deployment modes |
| Phase 6 — Productization | ⏳ Not started | 2 design partners in production |

**Current focus:** Phase 0 — WS-0.2 schemas and WS-0.4 Customer Onboarding reference artifacts are next.

## Workstream Tracking

Each phase has `docs/phaseN/README.md`. Update checkboxes as work completes. Never mark an exit criterion done until verifiably complete (demo recorded, test passing, schema validated in CI).

## Detailed Domain Instructions

For deep context on specific domains, see the targeted instruction files:
- Schema authoring → `.github/instructions/schemas.instructions.md`
- Runtime engines → `.github/instructions/runtime-engines.instructions.md`
- AI agents & models → `.github/instructions/ai-agents.instructions.md`
- ADR authoring → `.github/instructions/adrs.instructions.md`
