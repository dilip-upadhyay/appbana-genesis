# ADR-016: Deployment Packaging (Kubernetes-first)

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Dilip
- **Consulted:** Runtime engines team (ADR-013), Technology Adapter team (ADR-014), AI Agent team (ADR-015), Enterprise Sales, Security & Compliance

## Context and Problem Statement

AppBana Genesis must be deployable, unchanged, in three fundamentally different customer environments:

1. **SaaS multi-tenant** — we operate the platform; customers consume it through the web UI and API.
2. **Dedicated cloud single-tenant** — the platform runs in the customer's own AWS / Azure / GCP subscription; we operate it under a managed-service agreement.
3. **Air-gapped on-premises** — the platform runs on the customer's private Kubernetes cluster with no outbound internet at any time (financial regulators, defence, some healthcare). Installation happens from a signed offline bundle.

Every prior decision constrains this one:

- [ADR-013](ADR-013-runtime-engine-contract.md) — eight runtime engines must be independently deployable so that a single hot engine can be scaled without moving the others.
- [ADR-014](ADR-014-technology-adapter-contract.md) — technology adapters with `requiresNetwork: true` must be refused in air-gapped mode at kernel load, not at first use.
- [ADR-015](ADR-015-ai-model-adapter-layer.md) — AI adapters with `requiresNetwork: true` or `egressesInputsToThirdParty: true` likewise refused; the `aiRouting` map must resolve to only local models when the deployment mode is `air-gapped`.
- The CAM is the only kernel input (from [copilot-instructions.md](../../.github/copilot-instructions.md) locked decisions) — so **the same CAM must produce identical running behaviour in all three modes.** Any deployment-mode-conditional logic in the generated application would violate this.

We need a packaging and deployment contract that:

- Delivers **one artifact set** consumable by all three modes (not three parallel product lines).
- Has a **machine-readable deployment configuration** that carries the ADR-014 adapter bindings and the ADR-015 `aiRouting` map — so the governance publication gate ([ADR-017](ADR-017-governance-publication-gate.md)) can reason about it statically.
- Supports **fail-fast at deploy** rather than fail-slow at first user request.
- Never assumes internet access at runtime for on-prem deployments (though offline package acquisition is expected).

Without such a contract, sales cycles for regulated verticals stall on "can you run without any cloud call?" and the platform team fragments trying to maintain diverging build pipelines.

## Decision Drivers

- Enterprise operations teams standardize on Kubernetes (AKS / EKS / GKE / OpenShift / Rancher / k3s / plain k8s). Any other substrate loses deals.
- Air-gapped installs must succeed with **only** the signed offline bundle on a laptop and a target cluster — no `helm repo add` against a public repository, no `docker pull` from Docker Hub, no telemetry beacon-out.
- SaaS operators need canary and blue/green semantics; on-prem operators typically don't but must not be blocked from using them.
- Bring-your-own dependencies (customer's existing Postgres, MinIO/S3, Redis, Keycloak, OTLP collector) must be first-class — many enterprise customers refuse bundled databases even in dev.
- Bundled defaults must exist for every dependency so the platform can start on a fresh cluster with a single `helm install`.
- The AI Model Adapter routing table (ADR-015) and the technology adapter bindings (ADR-014) must live in the same values file the operator ingests, so a single change is one PR against one artifact.
- The Governance Publication Gate (ADR-017) must be able to answer "what is this deployment configured to do?" **before** the platform starts serving traffic. Deployment configuration must therefore be declarative and inspectable.
- Kernel version, CAM version, adapter versions, and platform version must all be visible in `/version` and `/readyz` so on-prem operators can produce evidence for change advisory boards.

## Considered Options

### Option A — Docker Compose only, ship k8s manifests as "advanced" appendix

Rejected. Enterprise customers with a k8s standard reject non-Helm-packaged software. Also loses per-runtime independent scaling, which ADR-013 requires.

### Option B — Bare Kubernetes manifests (kustomize) with no operator

Simplest to author, but every meaningful configuration change (adding a tenant, activating a new CAM version, rotating an adapter binding) becomes a shell script or a manual `kubectl apply`. Fails the "static inspectability by governance gate" driver. Rejected.

### Option C — Helm chart + Kubernetes Operator (CRDs), same OCI artifact set for all three modes, plus signed offline bundle for air-gapped *(chosen)*

Helm covers **installation and upgrade** of the platform. The operator covers **runtime configuration lifecycle** — tenants, CAM versions, adapter bindings, AI routing — via CRDs the governance gate can read. All images are single-source OCI artifacts tagged with the platform version; the offline bundle is a signed tarball of exactly those OCI artifacts + charts + CRDs + operator + optional bundled models.

### Option D — Bespoke installer binary (single Go/Rust static binary) that provisions everything

Reduces one moving part but re-invents k8s primitives that enterprise ops teams already understand and audit. Rejected on maintainability and ops-familiarity grounds; however, the offline bundle's *installer script* can be a thin wrapper that runs `helm install` behind the scenes.

## Decision

We adopt **Option C**: Helm + Kubernetes Operator + single OCI artifact set + signed offline bundle. The same charts, the same images, the same operator, and the same CRDs are used in all three deployment modes. Mode differences are expressed as values in a single `values.yaml` (or CR spec), never as different artifacts.

### Deployment Modes

Every deployment declares its mode via a single required value:

```yaml
platform:
  deploymentMode: saas | dedicated-cloud | air-gapped
```

The mode is read by the kernel at startup and enforces mode-specific invariants that the CRDs and manifests must satisfy. The invariants below are non-negotiable and are checked at admission time by the operator; violations produce a rejected CR with an explicit diagnostic.

| Invariant | `saas` | `dedicated-cloud` | `air-gapped` |
|---|---|---|---|
| Technology adapters with `requiresNetwork: true` | Allowed | Allowed | **Refused** |
| AI adapters with `requiresNetwork: true` | Allowed | Allowed | **Refused** |
| AI adapters with `egressesInputsToThirdParty: true` | Allowed unless tenant policy forbids | Allowed unless tenant policy forbids | **Refused** |
| Outbound telemetry to `*.appbana.io` | Enabled | Off by default; opt-in per contract | **Refused (must be false)** |
| Multi-tenant `GenesisTenant` CRs | Many | One (single-tenant) | One (single-tenant) |
| Image pull from external registries | Allowed | Allowed | **Refused** (in-cluster mirror or bundled digests only) |
| License / update calls | Continuous | Periodic | **Manual only** (offline license file, offline update bundle) |

The kernel refuses to start if any adapter, tenant, or platform config violates its mode's invariants — parallel to the ADR-014 "refuse to load a CAM whose capabilities are unsatisfied" behaviour.

### The Helm Chart

A single umbrella Helm chart, `charts/appbana-genesis-platform`, ships the platform. Sub-charts (each independently versionable) cover:

- `platform-kernel` — the deterministic core; one Deployment per runtime engine (per ADR-013), plus the kernel scheduler and provenance store.
- `platform-operator` — the Kubernetes operator + CRD definitions.
- `platform-api-gateway` — external entry point (REST + WebSocket for BA Agent).
- `platform-ui-shell` — Next.js chat UI (SaaS & dedicated only); disabled by default in air-gapped-headless installs.
- `platform-observability` — OTel collector + Jaeger + Prometheus (optional; bring-your-own supported via `enabled: false` and an `otlpEndpoint` value).
- `platform-persistence` — bundled Postgres StatefulSet + MinIO StatefulSet + Keycloak (optional; bring-your-own supported).
- `platform-ai-defaults` — optional bundled local models (Llama 3.3 70B, Whisper) for air-gapped installs; opt-in via `platform.aiDefaults.enabled: true`.

Every sub-chart honours `image.repository` and `image.tag` overrides so the platform can be pointed at a customer's in-cluster registry mirror.

Values documented in a top-level `values.yaml`; validated by a JSON Schema shipped alongside (`values.schema.json`) so `helm install` fails fast on typos.

### Kubernetes Operator and CRDs

The operator watches four CRDs. Each is namespaced; cluster-scope resources are rejected. All CRs are validated by OpenAPI v3 schemas embedded in the CRD definitions.

#### `GenesisApplication`

Declares a running application built from a CAM.

```yaml
apiVersion: appbana.io/v1alpha1
kind: GenesisApplication
metadata:
  name: customer-onboarding
  namespace: bank-a
spec:
  appId: customer-onboarding
  camRef:
    registry: oci://registry.internal/appbana/cam
    name: cam.customer-onboarding
    version: 0.1.0                              # semver; matches CAM MetadataModel.version
  tenantRef: bank-a                             # references a GenesisTenant CR
  topology:
    mode: monolith | microservices-per-runtime  # ADR-013 hot-path scaling
    replicas: 3
  runtimeEngineOverrides: []                    # per-engine resource overrides (only when topology=microservices-per-runtime)
  observability:
    traceSamplingRate: 1.0
status:
  phase: Pending | Publishing | Active | Blocked | Retiring
  publishedAt: "2026-07-24T10:30:00Z"
  gateChecks:                                   # populated by the ADR-017 governance gate
    schemaValidation: passed
    adapterCapabilityCoverage: passed
    aiAdapterTierAdequacy: passed
    humanReviewRequired: false
    ...
  conditions: [ ... ]
```

#### `GenesisTenant`

Declares a tenant and its policy envelope. In `saas` mode there are many; in `dedicated-cloud` and `air-gapped` there is exactly one.

```yaml
apiVersion: appbana.io/v1alpha1
kind: GenesisTenant
metadata:
  name: bank-a
  namespace: bank-a
spec:
  tenantId: bank-a
  environment: dev | staging | canary | prod   # matches Trace Event context.environment enum
  region: IN
  dataClassifications:                          # feeds ADR-014 & ADR-015 redaction
    pii:            { egressAllowed: false }
    sensitive-pii:  { egressAllowed: false }
  tenantAIPolicy:                               # per ADR-015 § PII, Data Residency, and Egress Policy
    allowThirdPartyModelEgress: false
    dataResidencyRequired: eu-central-1
    redactionPolicy: strict
  quotas:
    concurrentUsers: 100
    dailyAiTokenBudget: 5000000
```

#### `GenesisAdapterBinding`

Declares a technology or AI adapter binding available to the platform in this namespace. Cluster-wide bindings are expressed by placing the CR in the operator's system namespace with a namespace selector.

```yaml
apiVersion: appbana.io/v1alpha1
kind: GenesisAdapterBinding
metadata:
  name: data-postgres-primary
  namespace: bank-a
spec:
  adapterClass: technology | ai                # matches ADR-014 vs ADR-015 registry
  kind: data                                   # ADR-014 5-enum or ADR-015 5-enum
  binding: data:postgres                       # matches capability manifest binding
  packageRef: oci://registry.internal/appbana/adapters/data-postgres:1.4.0
  configRef:
    secretName: postgres-primary-credentials   # opaque; MUST live in a k8s Secret
  visibleToApplications:
    - customer-onboarding
status:
  conformanceTier: A | B | C                    # copied from adapter manifest
  loaded: true
  loadFailures: []
```

A single `GenesisApplication` is admitted only when every `(kind, binding)` referenced in its CAM has a corresponding `GenesisAdapterBinding` in scope, per ADR-014.

#### `GenesisAIRouting`

Declares the deployment's `aiRouting` map from ADR-015. Exactly one per namespace.

```yaml
apiVersion: appbana.io/v1alpha1
kind: GenesisAIRouting
metadata:
  name: default
  namespace: bank-a
spec:
  routes:
    - agent: agent.ba-agent
      capability: text-generation
      binding: ai:local-llama                  # MUST match a GenesisAdapterBinding of adapterClass=ai
    - agent: agent.ba-agent
      capability: speech-to-text
      binding: ai:local-whisper
    - agent: agent.normalization
      capability: structured-output
      binding: ai:local-llama-json
    - agent: agent.cam-generator
      capability: structured-output
      binding: ai:local-llama-json
```

The operator refuses to admit this CR if any route names an adapter binding not registered as an AI adapter, or if the resolved adapter's capability flags violate the deployment-mode invariants above.

### The Offline Bundle (Air-Gapped)

The offline bundle is a single signed tarball, `appbana-genesis-<platform-version>-offline.tar.zst`, produced by the CI release pipeline and cosign-signed. It contains:

1. `charts/` — the umbrella Helm chart and all sub-charts, pinned to exact digests.
2. `images/` — OCI layout directory (`oci-layout` v1.0.0) containing every image referenced by the charts at the versions they pin. Includes platform kernel images, all reference adapter images (from ADR-014 and ADR-015), and the operator image.
3. `models/` (optional, controlled by build flag) — bundled Llama 3.3 70B GGUF weights and Whisper model, each with SHA-256 and a model licence document.
4. `crds/` — CRD YAML files (identical to what the operator chart installs; provided separately so operators can install them ahead of the operator).
5. `install.sh` (plus PowerShell equivalent `install.ps1`) — thin wrapper that: verifies the cosign signature, loads OCI images into a target registry (customer-provided URL), then runs `helm install` with an `--values` file for air-gapped mode.
6. `SBOM.spdx.json` — Software Bill of Materials, SPDX 2.3, covering everything in the bundle.
7. `LICENSES/` — third-party licences for every bundled artifact.
8. `README.md` — installation instructions; MUST NOT reference any external URL for runtime operation.

The bundle's install script accepts only three inputs: target registry URL, cluster kubeconfig, and target namespace. No prompts, no environment variables required beyond `KUBECONFIG`. Installation is scripted so change advisory boards can review it as code.

### Local & Edge Development

- Local dev — [kind](https://kind.sigs.k8s.io/) with the same charts and the same operator. A `make dev-up` target ships in the repo scaffold; produces a working Customer Onboarding demo in under 5 minutes.
- Edge — [k3s](https://k3s.io/) with identical CRDs; the operator is small enough (< 200 MiB memory target) to run on a Raspberry Pi 5 or similar edge node.
- Production — any conformant Kubernetes 1.28+ distribution.

**No Docker Compose in production.** A minimal `docker-compose.yml` may exist for the very earliest local-dev experience but is not a supported deployment target.

### Version Compatibility and Upgrade Semantics

- Every image tag is a full semver, no floating tags in production.
- The umbrella chart's `Chart.yaml` pins every sub-chart to exact versions.
- Chart major bump requires an operator upgrade first (the operator MUST be at least the chart's major version).
- Kernel major bump follows the ADR-012 CAM major-bump migration story: the operator refuses to load CAM versions built against an older kernel major without an ADR-012 declarative migration on record.
- Downgrades are supported one minor version back; further requires a data restore.

### Observability, Health, and Version Endpoints

The platform exposes on every deployment mode:

- `GET /healthz` — liveness.
- `GET /readyz` — readiness; only returns 200 when the operator has admitted at least one `GenesisApplication`, all its adapters have `loaded: true`, and the governance gate has recorded a `passed` verdict.
- `GET /version` — JSON `{platformVersion, kernelVersion, operatorVersion, chartVersion, deploymentMode, loadedAdapters: [{kind, binding, adapterVersion, conformanceTier}], loadedCams: [{appId, camVersion}]}`. Consumed by change advisory boards.
- OTel traces exported to the configured OTLP endpoint (bundled Jaeger or bring-your-own).

### Security Baseline (Deployment-Layer)

- All images run as non-root, read-only root filesystem, with the minimum required capabilities.
- All inter-pod traffic uses mTLS via cert-manager (bundled) or the customer's service mesh (bring-your-own).
- Secrets are Kubernetes Secrets, never in ConfigMaps. External Secrets Operator integration is supported for Vault / AWS Secrets Manager / Azure Key Vault.
- Every image is cosign-signed; the offline bundle installer verifies signatures before loading.
- CIS Kubernetes Benchmark hardening notes ship with the platform docs.

## Consequences

### Positive

- **One artifact set for three modes** eliminates the fragmentation risk that would sink an enterprise-plus-SaaS product line.
- The CRDs give the governance publication gate ([ADR-017](ADR-017-governance-publication-gate.md)) a first-class, machine-readable substrate to reason about — no scraping of Helm values, no shell scripts to parse.
- Air-gapped installs become boring: one signed tarball, one install script, no cloud calls. This is the concrete artifact enterprise procurement teams ask for.
- The `deploymentMode` invariant table gives every adapter author a clear checklist of what "works in air-gapped" means. No hand-waving in ADRs.
- Bring-your-own dependencies coexist with bundled defaults without branching the chart or the operator.
- Operators (people) get familiar tools (Helm, kubectl, OpenAPI-validated CRs). Operators (software) get a small, focused controller.

### Negative

- Four CRDs is meaningful surface area to maintain, version, and document. Each CRD change is an operator release.
- Bundled local models make the offline bundle very large (Llama 3.3 70B GGUF ~40 GiB). Mitigated by making models an opt-in bundle flag and shipping a slim variant by default.
- The operator becomes a critical component; its own bugs can wedge admission. Mitigated by keeping the operator's logic minimal (validation + status reporting) and by making the platform still-serve-traffic when the operator is down for maintenance (admission failures only block *new* CRs).

### Neutral

- Kubernetes 1.28 minimum is a real constraint. Customers on older clusters will need to upgrade. Documented as a hard prerequisite.
- Helm is the packaging standard for now; a future ADR may add support for OperatorHub / OLM catalog manifests for OpenShift, but the underlying chart+operator model stays.

## Follow-ups

- **`values.schema.json` for the umbrella chart** — Phase 0.5 deliverable; feeds `helm install --dry-run` validation.
- **CRD OpenAPI schemas** — hand-authored initially; long term generated from a shared IDL that also produces the Go operator types.
- **Reference offline-bundle build pipeline** — Phase 5 deliverable; runs in the CI release job, produces the signed tarball, uploads the SBOM.
- **`make dev-up` target** — Phase 0.5 deliverable; kind cluster + charts + Customer Onboarding CAM up in one command.
- **CIS benchmark automation** — Phase 5; kube-bench profile shipped alongside the chart.
- **ADR-017 hook points** — governance gate consumes:
  - `deploymentMode` invariants (this ADR) as a mandatory pre-admission check for every `GenesisApplication`.
  - Adapter binding availability + tier (ADR-014, ADR-015) via `GenesisAdapterBinding.status`.
  - AI routing completeness (ADR-015) via `GenesisAIRouting`.

## References

- [ADR-012 — CAM Versioning](ADR-012-canonical-application-model-versioning.md)
- [ADR-013 — Runtime Engine Contract](ADR-013-runtime-engine-contract.md)
- [ADR-014 — Technology Adapter Contract](ADR-014-technology-adapter-contract.md)
- [ADR-015 — AI Model Adapter Layer](ADR-015-ai-model-adapter-layer.md)
- [Trace Event v0.1 schema — context.environment](../schemas/trace-event.v0.1.schema.json)
- [architecture.md § 12 — Technology Adapter Layer (Cloud/Deployment)](../../architecture.md)
- [execution-plan.md — Phase 5](../../execution-plan.md)
