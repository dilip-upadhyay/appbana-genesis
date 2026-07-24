# @appbana/ai-adapter-conformance-suite

Reusable conformance test runner every AI Model adapter must pass before its capability declaration is considered credible. This is the runtime companion to the [AI Adapter Manifest v0.1 schema](../../docs/schemas/ai-adapter-manifest.v0.1.schema.json).

- **Scope:** framework only. Ships fixtures + checks + a report shape. Does not embed any adapter.
- **Authority:** [ADR-015 § *Conformance Suite*](../../docs/adr/ADR-015-ai-model-adapter-layer.md); [ADR-017 `check.ai-governance`](../../docs/adr/ADR-017-governance-publication-gate.md).
- **Suite version:** `AI_ADAPTER_CONFORMANCE_SUITE_VERSION = "0.1.0"` — recorded in every emitted `ConformanceReport` and referenced by the AI Adapter Manifest's `conformanceEvidence[]` entries.

## Tiers

| Tier | Intent | Superset of |
|---|---|---|
| **C** | Runnable — contract shape + happy path + valid provenance. | — |
| **B** | Production-viable — abort, budget enforcement, contract-mismatch handling, streaming/rate-limit invariants. | C |
| **A** | Regulated workload — air-gapped invariant, determinism, redaction, data-residency echo. | B |

## Checks (v0.1)

### Tier C — Contract Shape (7 checks)
- `C.1` `adapter.kind === capabilities.kind`
- `C.2` `adapter.binding === capabilities.binding`
- `C.3` `capabilities.supportedResponseContracts` is non-empty
- `C.4` `init()` → `invoke()` → `shutdown()` completes on the happy path
- `C.5` `health()` returns a valid `AIAdapterHealth`
- `C.6` Provenance record on the happy path passes shape + hash-pattern + total-tokens checks
- `C.7` `correlationId` is echoed verbatim onto the result

### Tier B — Behavior (Tier C + 5 checks)
- `B.1` Aborted invocation returns quickly with `outcome !== "accepted"` (does not throw)
- `B.2` Unsupported response contract returns a diagnostic-carrying failure (does not throw)
- `B.3` Budget breach returns `outcome === "budget-exceeded"` (skipped unless cost fields declared)
- `B.4` Provenance `requestedAt <= completedAt`
- `B.5` `capabilities.supportsStreaming === true` iff `adapter.invokeStream` is defined

### Tier A — Policy (Tier B + 4 checks)
- `A.1` `requiresNetwork === false` implies `egressesInputsToThirdParty === false`
- `A.2` Same seed produces the same `outputHash` (skipped unless `supportsDeterminismHint === true`)
- `A.3` A classified input triggers a `provenance.redactions[]` entry (requires caller-supplied `redactionRequest` fixture)
- `A.4` `capabilities.dataResidencyGuarantee`, when set, matches `provenance.modelProviderRegion` on accepted results

Skipped checks do **not** fail the report; they surface with `skipped: true` and a `reason`.

## Usage

```ts
import { runConformance } from "@appbana/ai-adapter-conformance-suite";
import { MyAdapter } from "./my-adapter.js";

const report = await runConformance(new MyAdapter(), {
  tier: "B",
  config: { apiKey: process.env.MY_KEY },
});

if (!report.passed) {
  console.error(report.checks.filter((c) => !c.passed && !c.skipped));
  process.exit(1);
}
```

The returned `ConformanceReport` matches the `conformanceEvidence[]` item shape in the AI Adapter Manifest schema so it can be checked-in as evidence directly.

## Non-goals

- **Not a substitute for adapter-owned unit tests.** Adapters still need their own tests for vendor-specific error paths.
- **No network sandboxing.** A.1 is a manifest-consistency check, not an intrusive network sniffer. Runtime egress prevention is enforced by ADR-016's `NetworkPolicy` / air-gapped tenant policy, not this suite.
- **No performance benchmarking.** Latency and throughput belong in the platform's SLO harness (Phase 2+).
