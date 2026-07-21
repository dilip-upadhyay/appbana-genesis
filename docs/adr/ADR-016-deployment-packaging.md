# ADR-016: Deployment Packaging (Kubernetes-first)

- **Status:** Proposed
- **Date:** 2026-07-19
- **Deciders:** _TBD_
- **Consulted:** DevOps / Platform Engineering, Enterprise Sales

## Context and Problem Statement

AppBana Genesis must be deployable in three modes:

1. **SaaS multi-tenant** (managed by us).
2. **Dedicated cloud single-tenant** (customer's Azure/AWS/GCP subscription).
3. **On-premises / air-gapped** (customer's private Kubernetes, no internet).

Both the platform itself and every generated application must ship identically across these modes. Custom installers or Docker-Compose-only packaging will lose enterprise deals.

## Decision Drivers

- Enterprise operations teams standardize on Kubernetes (AKS, EKS, GKE, OpenShift, Rancher, k3s).
- Air-gapped installations require offline bundles with zero external calls at runtime.
- The same CAM must produce identical deployments across all three modes.
- Two topologies must be supported per generated application: monolithic-per-app and microservices-per-runtime.

## Considered Options

_To be developed during Phase 0 ADR workshop._

## Decision

_Pending. Direction:_

- **Kubernetes as the deployment substrate everywhere.**
- Helm charts for the platform (`appbana-genesis-platform`) and for generated applications.
- Kubernetes Operator with CRDs: `GenesisApplication`, `GenesisTenant`, `GenesisAdapter`.
- Offline installer bundle (signed tarball) for air-gapped mode with all images + charts + operator + optional bundled Llama model.
- Bring-your-own dependencies (Postgres, MinIO, Redis, Keycloak) supported alongside bundled defaults.

## Consequences

_Pending._

## References

- [architecture.md § 12 — Technology Adapter Layer (Cloud/Deployment)](../../architecture.md)
- [execution-plan.md — Phase 5](../../execution-plan.md)
