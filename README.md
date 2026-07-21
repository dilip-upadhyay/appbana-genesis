# AppBana Genesis

AppBana Genesis is an AI-native enterprise application creation platform that transforms business intent into governed metadata, executable runtimes, and technology-independent enterprise applications.

> **Core thesis:** business intent should survive technology change.

## Documents

| Document | Purpose |
|---|---|
| [architecture.md](architecture.md) | Baseline architecture (v1.0 draft) |
| [execution-plan.md](execution-plan.md) | Phase-wise execution plan (Phase 0 → Phase 6) |
| [docs/phase0/README.md](docs/phase0/README.md) | Live Phase 0 workstream tracker |
| [docs/adr/README.md](docs/adr/README.md) | Architecture Decision Records index |
| [docs/schemas/README.md](docs/schemas/README.md) | Canonical schemas catalog |

## Repository Layout

```text
appbana-genesis/
├─ architecture.md              # Baseline architecture document
├─ execution-plan.md            # Phase-wise execution plan
├─ docs/
│  ├─ adr/                      # Architecture Decision Records
│  ├─ schemas/                  # BIM / AIM / CAM JSON Schemas
│  └─ phase0/                   # Phase 0 workstream tracker
├─ packages/                    # Platform packages (kernel, runtimes, adapters, schemas)
├─ apps/                        # End-to-end demo applications
├─ examples/                    # Reference scenarios (Customer Onboarding, Expense Approval, Insurance Claim)
├─ tools/                       # CLIs (validator, trace viewer, migration runner)
├─ .github/                     # CI, CODEOWNERS, PR template
├─ package.json                 # pnpm workspace root
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ .nvmrc                       # Node 22 LTS
```

## Prerequisites

- Node.js **22 LTS** (see [`.nvmrc`](.nvmrc))
- pnpm **10.x** (`corepack enable && corepack use pnpm@10.15.0`)

## Getting Started

```powershell
# 1. Install dependencies
pnpm install

# 2. Verify workspace scripts (no-ops until packages land)
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Package folders under `packages/` are populated workstream-by-workstream as ADRs land — see [`packages/README.md`](packages/README.md) for the intended layout and [`docs/phase0/README.md`](docs/phase0/README.md) for current status.

## Current Phase: **Phase 0 — Foundation & Alignment**

- Repo scaffolding: **complete**
- [ADR-011 BIM ↔ AIM Boundary](docs/adr/ADR-011-bim-aim-boundary.md): **Accepted**
- ADR-012 through ADR-017: **Proposed**, awaiting workshops
- Schemas (BIM / AIM / CAM / Operation / Trace): **not started**
- Customer Onboarding reference artifacts: **not started**

See [docs/phase0/README.md](docs/phase0/README.md) for the live tracker.

## License

UNLICENSED — proprietary. Not for redistribution during pre-Phase-1 development.

