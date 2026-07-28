# @appbana/engine-contract

The executable form of [ADR-013 — Runtime Engine Contract & Lifecycle](../../docs/adr/ADR-013-runtime-engine-contract.md).

Before this package existed, ADR-013 was prose. `RuntimeEngine` and `EffectDescriptor` appeared in nine files across the repository — every one of them Markdown or JSON. Nothing prevented an engine author from calling a database, reading the wall clock, or inventing an effect kind. This package makes the contract something the compiler and CI can enforce.

## Why this landed before the first engine

The cost of defining the contract rises with every engine written. With zero engines in the repo it is one small package; after eight engines exist it is a rewrite of eight packages plus their tests — and by then the contract will have been violated in ways that are expensive to unwind. ADR-013 locks the engine set at eight, so the contract is bounded and worth pinning down now.

## What it exports

| Concern | Exports |
|---|---|
| Engine interface | `RuntimeEngine`, `EngineResult`, `ExecutionContext`, `EngineCapabilityDeclaration`, `TraceLogger`, `EnginePrincipal` |
| Effects | `EffectDescriptor` union, `EFFECT_TYPES`, `effectViolation`, `isEffectDescriptor` |
| Diagnostics | `Diagnostic`, `DIAGNOSTIC_SEVERITIES`, `diagnosticViolation`, `hasError` |
| Trace | `TraceEvent` and its parts, `ENGINE_IDS`, `ENGINE_SUB_MODEL`, `MANDATED_TRACE_DECISIONS`, `traceEventViolation` |
| Determinism | `createExecutionContext`, `seededRandom`, `steppedClock`, `recordingLogger` |
| Certification | `runConformanceSuite`, `formatReport`, `ConformanceReport` |
| JSON purity | `Json`, `isJson`, `jsonViolation`, `canonicalJson` |

## The conformance suite

```ts
import { runConformanceSuite, formatReport } from "@appbana/engine-contract";

const report = await runConformanceSuite(myEngine, fixtures, { traceSchemaValidator });
assert.equal(report.conformant, true, formatReport(report));
```

It runs twelve checks and **never short-circuits** — an engine author fixing conformance wants the whole list, not the first failure.

| Check | What it proves |
|---|---|
| `engine-identity` | `engineId` is one of the eight locked ids; `engineVersion` is semver |
| `sub-model-ownership` | `camSubModelId` matches ADR-013's locked 1:1 map |
| `capability-declaration` | `deterministic: true`, valid version range and flags |
| `trace-decision-mapping` | Every mandated trace decision is mapped to a concrete `event.*` kind |
| `purity-json-safe` | Output can cross a language boundary — no `Date`, `Map`, `undefined`, `NaN`, functions, cycles |
| `determinism` | Two runs with identically seeded contexts are **byte-identical** |
| `effect-union-membership` | Every effect is in the closed union, with a `correlationId` |
| `trace-event-envelope` | Structural pre-check with actionable messages |
| `trace-schema-validation` | Ajv against the real `trace-event.v0.1.schema.json` |
| `mandated-trace-completeness` | Every mandated decision was actually emitted across the fixtures |
| `diagnostic-taxonomy` | Severity and dotted-code discipline |
| `no-throw-on-expected-failure` | `execute()` returned a diagnostic instead of throwing |

### Negative controls

The suite's own tests include eight deliberately broken engines — non-deterministic, ad-hoc effect, wrong sub-model, throwing, missing W3C trace context, non-JSON output, `deterministic: false`, and incomplete trace coverage. Each fails *exactly* the check it was built to violate. A conformance suite that only ever sees compliant input proves nothing.

## Determinism, concretely

An engine is deterministic iff the same `(subModel, input, context)` — with `now` and `random` seeded identically — yields a byte-equivalent `EngineResult`.

`createExecutionContext({ randomSeed, startedAt })` makes that testable. The clock **advances** rather than freezing (a frozen clock hides ordering bugs) but is fully reproducible, and `seededRandom` is mulberry32, chosen precisely because it is not cryptographic.

Comparison uses `canonicalJson`, which sorts object keys at every depth so two semantically identical results built by different code paths do not compare unequal. Array order stays significant — it is meaningful in `effects` and `traceEvents`.

## The effect model

Engines return descriptors; the kernel applies them. The union is closed at six kinds and `EFFECT_TYPES` is asserted in tests, so widening it breaks a test on purpose — ADR-013 makes adding an effect kind an ADR-worthy event.

`schedule` cannot nest another `schedule`: recursive scheduling has no bounded expansion and cannot be statically audited before the kernel applies it.

## Build-time enforcement

`eslint.config.mjs` carries an ADR-013 block scoped to the eight engine packages that bans wall-clock reads, `Math.random()`, `crypto.randomUUID()`, filesystem/network/process access, database clients, AI SDKs, and BIM/AIM imports. Verified against a probe file: all nine planted violations were caught.

The block is scoped to the eight named engines rather than a `runtime-*` glob because `runtime-session` is a kernel-side coordinator, not an engine, and legitimately owns a default-injection clock seam.

## Known deviations from ADR-013

See [docs/deviations.md](../../docs/deviations.md). In short:

- **DEV-004** — ADR-013 writes the `schedule` payload as `Omit<EffectDescriptor, 'correlationId'>`, which collapses a union to its common keys in TypeScript and would erase every discriminated member field. Implemented with a distributive omit, which is plainly the intent.
- **DEV-005** — ADR-013 says `TraceEvent`, `EffectDescriptor`, and `Diagnostic` types are *generated* from JSON Schemas. Only `trace-event` has a schema today, and no codegen exists anywhere in the repo. These types are hand-written and pinned to the schema by an Ajv test instead.

## Scripts

```powershell
pnpm run build      # tsc -p tsconfig.build.json
pnpm run typecheck  # tsc --noEmit (includes __tests__)
pnpm run lint       # eslint .
pnpm run test       # build, then node --test
```

## Status

Phase 1 · WS-1.5 prerequisite. 53 tests. No engine implements this contract yet — that is the next workstream.
