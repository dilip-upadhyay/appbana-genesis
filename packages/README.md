# Packages

Package layout for AppBana Genesis. Individual package folders and their `package.json` files will be created workstream-by-workstream as their governing ADRs land, so we do not lock in dependencies prematurely.

## Intended Layout (per architecture.md § 19)

```text
packages/
  business-intent-model/         # BIM schema + TS types + validators (WS-0.2)
  application-intent-schema/     # AIM schema + TS types + validators (WS-0.2)
  canonical-application-model/   # CAM schema + TS types + validators (WS-0.2)
  platform-kernel/               # Deterministic execution core (Phase 1)
  governance-engine/             # Publication gate + validators (Phase 1/2)
  metadata-registry/             # Immutable artifact store (Phase 1)
  migration-engine/              # Schema/model evolution (Phase 2+)
  conformance-suite/             # Runtime + adapter certification (Phase 2+)
  ai-application-agent/          # AI orchestration (Phase 1)

  runtime-interaction-ui/        # UI runtime engine
  runtime-workflow/              # Workflow runtime engine
  runtime-rules/                 # Rules runtime engine
  runtime-operations/            # Semantic operations runtime engine
  runtime-data/                  # Data runtime engine
  runtime-integration/           # Integration runtime engine
  runtime-security-policy/       # Security/policy runtime engine
  runtime-observability/         # Observability runtime engine

  adapter-ui-react/              # React UI adapter (Phase 1)
  adapter-ui-webcomponents/      # Web Components UI adapter
  adapter-backend-mock/          # Mock backend adapter (Phase 1)
  adapter-data-memory/           # In-memory data adapter (Phase 1)
  adapter-data-postgres/         # PostgreSQL data adapter (Phase 2)
  adapter-data-sqlite/           # SQLite data adapter (Phase 2)
  adapter-ai-anthropic/          # Anthropic model adapter (Phase 1)
  adapter-ai-openai/             # OpenAI model adapter (Phase 1)
  adapter-ai-llama/              # Local Llama adapter (Phase 3)
```

## Package Conventions (draft — finalize under ADR-013)

- Each package has its own `package.json`, `tsconfig.json` extending `../../tsconfig.base.json`, `src/`, and `test/`.
- Package name: `@appbana/<folder-name>`.
- Public API exported through `src/index.ts` only.
- Every package must declare `build`, `test`, `lint`, `typecheck` scripts (used by the root pnpm scripts).
- Runtime engines and adapters must publish conformance test fixtures alongside their implementation.

## Sibling Roots

- [`apps/`](../apps) — end-to-end demo applications (e.g., `customer-onboarding-demo`)
- [`examples/`](../examples) — reference metadata artifacts (BIM/AIM/CAM)
- [`tools/`](../tools) — CLIs: `validator-cli`, `trace-viewer`, `migration-runner`
