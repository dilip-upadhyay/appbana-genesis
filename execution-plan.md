# AppBana Genesis — Phase-Wise Execution Plan

**Status:** Draft v1 — ready for review
**Owner:** Dilip
**Baseline document:** [architecture.md](architecture.md)

**Key pre-Phase-0 decisions confirmed:**

- BIM = business-language, AIM = canonical schema-conformant, AI agent is the only bridge
- Kubernetes-first packaging (Helm + Operator + OCI + offline installer)
- Multi-model AI adapter (Claude Sonnet 4.5 + GPT-4o cloud, Llama 3.3 70B on-prem)
- Slice 1: Customer Onboarding, Slice 2: Expense Approval, Slice 3: Insurance Claim

---

## Guiding Principles for Execution

1. **Every phase ends with a runnable demo, not a document.**
2. **Every phase runs the previous phase's demo plus one new capability.** No regressions.
3. **Trace viewer + governance gate are alive from Phase 1 onward.** They are the credibility proof.
4. **AI agents are first-class from day one.** Not deferred to a later phase.
5. **The Customer Onboarding scenario is the "always-green" fixture** through all phases.

---

## Phase 0 — Foundation & Alignment

**Duration:** 4–6 weeks | **Team:** Small (3–5 people: architect, senior engineer, AI/ML engineer, product lead)

### Workstreams

**WS-0.1 Architecture Decision Records (ADR-011 through ADR-017)**

- ADR-011: BIM vs AIM boundary contract
- ADR-012: Canonical Application Model versioning strategy
- ADR-013: Runtime engine contract & lifecycle
- ADR-014: Technology adapter contract & conformance
- ADR-015: AI model adapter layer & provenance
- ADR-016: Deployment packaging (Kubernetes-first)
- ADR-017: Governance publication gate & rollback

**WS-0.2 Schema Definitions**

- Business Intent Model v0.1 (JSON Schema)
- Application Intent Model v0.1 (JSON Schema)
- Canonical Application Model v0.1 with 10 sub-models (JSON Schema)
- Operation Contract Schema v0.1
- Trace Event Schema v0.1

**WS-0.3 Repository Scaffolding**

- Monorepo setup (pnpm workspaces)
- Package layout per Section 19 of architecture.md
- CI pipeline (build, test, lint, schema validation)
- Container image build pipeline (per-package OCI images)
- Documentation site (Docusaurus or similar — decide via spike)

**WS-0.4 Reference Scenario Specification**

- Customer Onboarding fully specified as BIM v0.1 (hand-authored, no AI yet)
- Customer Onboarding fully specified as AIM v0.1 (hand-authored)
- Customer Onboarding fully specified as CAM v0.1 (hand-authored)
- Success criteria: three artifacts round-trip through validators without loss

**WS-0.5 Tech Stack Decisions**

- Platform language: TypeScript (Node) primary, with Rust/Go reserved for kernel hot paths later
- Runtime: Node 22 LTS
- Persistence (Phase 1 default): PostgreSQL for platform, SQLite for demo apps
- AI orchestration: LangGraph or custom orchestrator (decide via spike)
- Container: Docker + BuildKit
- Kubernetes: kind for local, k3s for edge, standard K8s for prod
- Observability: OpenTelemetry from day one

**WS-0.6 Team & Ops Setup**

- GitHub org + repo access model
- Branching model (trunk-based with short-lived branches)
- Security baseline (Dependabot, secret scanning, SBOM generation)
- Coding standards + PR review protocol

### Exit Criteria

- All 7 ADRs written, reviewed, approved
- All schemas v0.1 published in the repo
- Repo scaffold builds and CI is green
- Customer Onboarding reference artifacts validate cleanly
- Phase 1 backlog is executable (each task has AC + estimate)

---

## Phase 1 — AI Intake + Minimal Runtime (The "Describe → Deploy" Proof)

**Duration:** 10–12 weeks | **Team:** 6–8 people (add UI engineer, backend engineer, DevOps)

**Primary Deliverable:** A business user describes Customer Onboarding in a chat interface → the platform produces a running form with conditional rules and mock operations. Zero hand-written metadata.

### Workstreams

**WS-1.1 Conversational BA Agent (chat-only, no audio yet)**

- Chat UI (Next.js + shadcn or similar)
- Session/thread management (persistence in Postgres)
- BA agent orchestration (LangGraph-based state machine)
- Clarification loop (agent asks, user answers, BIM builds up)
- Use case + test scenario generation
- Confirmation presentation (show BIM back to user in readable form)

**WS-1.2 AI Model Adapter Layer**

- Adapter interface (contract)
- Claude Sonnet 4.5 adapter (via Anthropic API)
- GPT-4o adapter (via OpenAI API)
- Prompt template registry (versioned templates)
- Provenance recorder (every AI call logged with hash + version)
- Cost & token tracking

**WS-1.3 Intent Translation Pipeline**

- BIM → AIM normalization agent
- AIM validator (schema + reference resolution)
- AIM → CAM canonical generator (deterministic, no AI)
- Governance validator (schema + intent completeness only in Phase 1)
- Metadata Registry (immutable artifact store in Postgres)

**WS-1.4 Minimal Platform Kernel**

- Artifact resolution (by appId + version)
- Runtime session lifecycle
- Event bus (in-process for Phase 1)
- Effect descriptor model
- Trace context propagation (OTel-backed)

**WS-1.5 Minimal Runtime Engines**

- **UI Runtime**: renders form from CAM InteractionModel
  - Field types: text, number, select, date, checkbox, textarea, file
  - Conditional visibility from RuleModel
  - Client-side validation from RuleModel
- **Rules Runtime**: evaluates conditions and derives state
  - Boolean expressions, comparisons, string ops
  - No arithmetic beyond compare (arithmetic in Phase 2)
- **Operations Runtime**: executes semantic operations (mock adapters only)
  - `customer.saveDraft:v1` → in-memory
  - `customer.validateTaxId:v1` → mock (always pass)
  - `document.upload:v1` → local filesystem
- **Observability Runtime**: emits structured trace events
  - Every field render, rule fire, operation call

**WS-1.6 UI Adapter — React (minimal)**

- Render-tree consumer for UI Runtime
- Conformance test suite (Tier A capabilities only)
- No page-specific business logic anywhere in React code

**WS-1.7 Trace Viewer Tool**

- Web UI to browse traces
- Filter by app version, session, user, event type
- Show "why did this field appear" / "which rule fired"
- This is the credibility artifact — invest here

**WS-1.8 Customer Onboarding Demo v1**

- End-to-end: chat with BA agent → confirm BIM → click "Generate" → see running form
- Applicant persona only (multi-role in Phase 2)
- Country-based conditional field logic works
- All actions traceable in the Trace Viewer

### Exit Criteria

- **Demo works end-to-end** — recorded video shows business user producing a running application from chat in under 15 minutes
- All AI calls have full provenance records
- Trace Viewer shows deterministic replay of every user action
- CI passes for all packages
- Governance validator rejects intentionally-broken BIMs correctly
- Zero page-specific React business logic in the codebase

---

## Phase 2 — Full Application Slice (Customer Onboarding as a Real Enterprise App)

**Duration:** 10–12 weeks | **Team:** 8–10 people (add security engineer, QA)

**Primary Deliverable:** Customer Onboarding becomes a full enterprise application — workflow, real persistence, multi-role access, audit trail — all from metadata.

### Workstreams

**WS-2.1 Workflow Runtime**

- State machine execution (draft → submitted → reviewed → approved/rejected → resubmitted)
- Guard conditions from RuleModel
- Task assignment (applicant/reviewer/manager/auditor)
- Delegation model (Phase 2 primitive, expanded in Phase 3)
- Workflow trace events

**WS-2.2 Security/Policy Runtime**

- RBAC + field-level ABAC
- Identity context propagation
- Operation authorization enforcement
- Data classification tagging
- Auth adapter: local + OIDC (Keycloak reference)

**WS-2.3 Data Runtime**

- Entity persistence abstraction
- Adapter: PostgreSQL (production)
- Adapter: SQLite (dev/demo)
- Schema migration engine (metadata-driven)
- Query projection with security filtering

**WS-2.4 Real Semantic Operations**

- `customer.saveDraft:v1` → PostgreSQL
- `customer.validateTaxId:v1` → real HTTP call (mock service in Phase 2)
- `document.upload:v1` → object storage adapter (MinIO local, S3-compatible)
- `customer.submitOnboarding:v1` → workflow transition + notification
- Full operation contracts with retry, idempotency, error taxonomy

**WS-2.5 Governance Publication Gate (all 10 checks)**

- Schema, Security, Privacy, Accessibility, Compatibility, Operation, Performance, AI-governance, Human-approval, Rollback-ready
- Governance UI (basic — approve/reject with diff view)
- Rollback mechanism

**WS-2.6 Observability Runtime Hardening**

- Metrics (Prometheus format)
- Distributed tracing (OTel to Jaeger)
- Audit log stream (immutable, SOX-grade)
- Explain API: "why is this field visible?" / "why did this rule fire?"

**WS-2.7 Conformance Suite v0.1**

- UI Runtime conformance tests
- Operation Runtime conformance tests
- Data Runtime conformance tests
- Adapter certification harness

**WS-2.8 Customer Onboarding Demo v2 (full app)**

- All 4 roles working
- Real submit → review → approve flow
- Documents uploaded to object store
- Full audit trail
- Rollback from bad artifact publish works

### Exit Criteria

- Customer Onboarding runs as a full enterprise app
- Governance gate blocks intentionally-unsafe artifacts (test corpus)
- Conformance suite passes for React UI adapter, Postgres data adapter, Mock backend adapter
- Rollback tested end-to-end
- Load test: 100 concurrent onboarding sessions with acceptable latency
- Security review passed (external or internal)

---

## Phase 3 — Multi-Modal Intake + Second Vertical (Expense Approval)

**Duration:** 12–14 weeks | **Team:** 10–12 people (add ML engineer for document AI)

**Primary Deliverable:** (1) Users can input requirements as chat, audio, PDF, or images. (2) A completely different application (Expense Approval) is generated with zero platform code changes — proving generality.

### Workstreams

**WS-3.1 Multi-Modal Intake Agents**

- Speech-to-Intent (Whisper + BA agent)
- Document Understanding (Claude vision + Azure Doc Intelligence adapter)
- Image/Diagram Intent (whiteboard photo → BIM)
- Multi-session context (return to a partially specified app)

**WS-3.2 Multi-Agent Orchestration Framework**

- Named agents: BA, Domain Modeler, Rules Extractor, Validation, Migration
- Agent handoff protocol
- Shared context/blackboard
- Human-in-the-loop pauses (agent asks user for clarification)

**WS-3.3 Extended Rule Model (for Expense Approval)**

- Arithmetic operations (amount thresholds)
- Aggregations (sum of line items, per-fiscal-period totals)
- Temporal rules ("expenses older than 60 days...")
- Hierarchical policy inheritance (org-wide → dept → user)

**WS-3.4 Workflow Runtime v2**

- Amount-based routing
- Multi-branch parallel approvals
- Delegation & impersonation (SOX-compliant)
- Escalation timers

**WS-3.5 Notification Runtime (new)**

- Email adapter
- Slack/Teams adapter
- Mobile push adapter (Firebase/APNS)
- Template-driven, metadata-defined

**WS-3.6 UI Runtime Mobile Support**

- Responsive rendering (desktop, tablet, mobile)
- Approval-optimized mobile UI (approve/reject with one tap)

**WS-3.7 Expense Approval Vertical Slice**

- Full BIM authored by business user via multi-modal intake
- Multi-currency, per-department budgets, tiered approvals
- Mock ERP integration (real ERP in Phase 4)
- Mobile approval demo

### Exit Criteria

- Expense Approval works end-to-end without any platform code changes specific to expenses
- Multi-modal intake produces the same-quality BIM as pure-chat intake
- Trace Viewer explains delegated approvals correctly
- Governance gate handles both apps identically

---

## Phase 4 — Integration Runtime + Backend Adapter Expansion

**Duration:** 10–12 weeks

**Primary Deliverable:** Semantic operations can call real external systems (REST, Kafka, gRPC). A generated application deploys as containerized Java microservices, not just as a hosted Node runtime.

### Workstreams

**WS-4.1 Integration Runtime**

- REST adapter (with OpenAPI import → operation contract)
- gRPC adapter (with proto import)
- Kafka adapter (producer + consumer, topic-driven)
- Pub/Sub adapter (Google Pub/Sub, Azure Service Bus)
- Async operation contracts (fire-and-forget, request-reply, streaming)

**WS-4.2 Java Backend Adapter**

- Java Spring Boot service generated from operation contracts
- CAM → Spring Boot project template
- Build pipeline (Maven + Docker image)
- Same operation semantics as Node runtime (conformance-tested)

**WS-4.3 Real Data Adapters**

- PostgreSQL (mature)
- MongoDB (NoSQL proof)
- Oracle (enterprise proof)
- Data migration between adapters (metadata-preserving)

**WS-4.4 Third Vertical: Insurance Claim Intake (partial)**

- Long-running case management
- Document-heavy (photos, PDFs, external reports)
- External data enrichment (weather API, vehicle data mock)
- Payout operation (with two-phase commit semantics)

**WS-4.5 Conformance Suite Expansion**

- Backend adapter cross-language conformance (Node vs Java produce same behavior)
- Integration adapter conformance
- Data adapter cross-store conformance

### Exit Criteria

- Same CAM produces functionally identical Node and Java deployments
- Real Kafka events flow through Expense Approval
- Insurance Claim proves long-running processes work
- All 3 vertical slices run on the platform simultaneously

---

## Phase 5 — Deployment, Packaging & On-Premises

**Duration:** 8–10 weeks

**Primary Deliverable:** The platform and every generated application deploy identically on managed cloud, dedicated cloud, and air-gapped on-premises Kubernetes.

### Workstreams

**WS-5.1 Platform Helm Chart**

- `appbana-genesis-platform` chart
- Bundled deps: Postgres, MinIO, Redis, Keycloak (or bring-your-own)
- Configurable AI provider (cloud vs local)

**WS-5.2 Generated Application Packaging**

- CAM → Helm chart generation
- Two topologies: monolithic-per-app and microservices-per-runtime
- Auto-generated Kubernetes resources (Deployment, Service, Ingress, HPA, NetworkPolicy)

**WS-5.3 Kubernetes Operator**

- CRDs: `GenesisApplication`, `GenesisTenant`, `GenesisAdapter`
- Rolling upgrades, migrations, secret rotation
- Health/readiness contract

**WS-5.4 On-Premises Installer**

- Offline bundle (signed tarball with all images + charts + operator)
- Air-gapped registry sync tool
- Bundled Llama 3.3 70B model option (with GPU requirement docs)
- Quantized model option for CPU-only

**WS-5.5 Multi-Tenant SaaS Mode**

- Tenant isolation (namespace + network policy + RBAC)
- Per-tenant registry
- Workspace management UI

**WS-5.6 Deployment Model in CAM**

- Business user's deployment intent → platform picks topology
- Environment promotion (dev → staging → prod)
- Blue/green + canary support

### Exit Criteria

- Customer Onboarding deploys identically to Azure AKS, on-prem K8s, and air-gapped K8s from the same CAM
- Offline installer bundle installs successfully on a truly disconnected cluster
- Multi-tenant SaaS supports at least 10 tenants with isolation verified

---

## Phase 6 — Productization

**Duration:** Ongoing

**Primary Deliverable:** Design partner pilot with 2–3 external customers, 80% standard runtime coverage.

### Workstreams

**WS-6.1 Governance UI**

- Visual diff viewer for BIM/AIM/CAM changes
- Approval workflow UI
- Rollback controls
- Provenance browser

**WS-6.2 Capability Packs**

- Financial Services pack (KYC, AML, credit workflows)
- Healthcare pack (patient intake, HIPAA baseline)
- Retail pack (order management, RMA)
- Pack authoring & distribution tooling

**WS-6.3 Marketplace Foundation**

- Adapter marketplace
- Operation contract marketplace
- Signed & versioned packs

**WS-6.4 Enterprise Readiness**

- SOC2 / ISO 27001 controls
- Penetration test cycle
- SLA & support tiering
- Documentation & training program

**WS-6.5 Design Partner Program**

- 2–3 pilot customers (mix of on-prem and SaaS)
- Feedback loop into roadmap
- Reference architecture publications

---

## Critical Dependencies & Sequencing

```text
Phase 0 (Foundation)
    ↓
Phase 1 (AI Intake + Minimal Runtime) ── depends on schemas + kernel
    ↓
Phase 2 (Full App Slice) ── depends on P1 kernel + runtimes
    ↓                    ╲
    ↓                     ╲── Phase 4 (Integration) can start P4.1 in parallel with late P3
Phase 3 (Multi-modal + Slice 2) ── depends on P2 governance
    ↓
Phase 4 (Integration + Adapters + Slice 3)
    ↓
Phase 5 (Deployment/Packaging) ── can start P5.1 in parallel with mid-P4
    ↓
Phase 6 (Productization) ── ongoing after P5 GA
```

---

## Immediate First-Week Actions

1. **Kick off Phase 0** — schedule the 7 ADR workshops (one per week for 7 weeks with prep in parallel)
2. **Assign schema owners** — one senior engineer per schema (BIM, AIM, CAM)
3. **Create the repo** — scaffold monorepo, CI, container build, docs site
4. **Author Customer Onboarding BIM by hand** — no AI yet, just the reference artifact
5. **Spike: LangGraph vs custom orchestrator** — 3-day timeboxed evaluation
6. **Spike: Multi-model adapter interface** — prototype Claude + GPT-4o adapter with identical output contract
7. **Set up eval framework** — how you'll measure BA agent quality across model providers
8. **Hire/allocate the Phase 1 team** — 6–8 people confirmed

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Scope creep in Phase 1 (temptation to add features) | Trace Viewer + governance gate discipline; ship the "chat → running form" demo and stop |
| AI agent quality doesn't meet business-user expectations | Multi-model adapter lets you swap; invest in eval harness in Phase 0 |
| Metadata model becomes a hidden programming language | Rigid AIM schema + no arbitrary expressions; escape hatch via registered extensions only |
| On-prem customers reject due to AI cloud dependency | Local model support from Phase 1 (Llama adapter alongside Claude/GPT) |
| Adapter conformance not real | Conformance suite from Phase 2, cross-language proof in Phase 4 |
| Second vertical exposes CAM design flaws | Choose Expense Approval specifically to stress-test; be willing to break CAM v0.1 and ship v0.2 in Phase 3 |
| Team scaling faster than architecture stabilizes | Keep Phase 0 small (3–5), grow only when ADRs are locked |

---

## Success Metrics per Phase

| Phase | Key Metric |
|---|---|
| P0 | 7 ADRs approved, all schemas validate reference artifact |
| P1 | Business user → running form in <15 min via chat, zero page-specific code |
| P2 | Full Customer Onboarding at 100 concurrent users, security review passed |
| P3 | Expense Approval delivered with zero platform code changes |
| P4 | Same CAM produces Node + Java deployments with identical behavior |
| P5 | Air-gapped install succeeds; identical deployment across 3 environments |
| P6 | 2 design partners in production, 80% capability coverage |
