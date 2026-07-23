# ADR-013: Runtime Engine Contract & Lifecycle

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Dilip
- **Consulted:** Architecture team, Runtime Engine leads (UI, Workflow, Rules, Operations, Data, Integration, Security/Policy, Observability), Platform Kernel lead
- **Informed:** All Phase 0 – Phase 4 workstreams, Conformance Suite owners

## Context and Problem Statement

The Canonical Application Model (CAM) is executed by eight independent runtime engines. Each engine consumes a single CAM sub-model, produces observable behavior, and must be independently replaceable — including cross-language replacements (a Node.js engine today, a Rust engine tomorrow) — without touching the kernel or the CAM.

Without a formal engine contract, the following break down:

- **Determinism.** Same CAM + same inputs must always produce the same outputs. If one engine performs its own IO, that guarantee collapses.
- **Traceability.** The Trace Viewer must answer "why did this field appear?" and "why did this rule fire?" This requires every engine to emit trace events in a uniform envelope.
- **Testability.** Engines must be unit-testable without a database, message bus, or network. If side effects are performed in-engine, unit tests degrade into integration tests.
- **Conformance.** Alternate engine implementations (Rust hot-path engines, WASM sandboxes) must be certifiable against a fixed contract, not against the reference implementation's behavior.
- **Effect governance.** All persistence, notification, dispatch, and transition effects must flow through the kernel so that Security/Policy and Observability can gate them uniformly.

## Decision Drivers

- **Determinism first.** Engines must be pure functions of `(sub-model, input, context)` — no wall clock, no random, no IO, no AI.
- **Language neutrality.** The contract is expressed as a data protocol first, a TypeScript interface second. A Rust or Go engine that speaks the same protocol is a first-class replacement.
- **One CAM sub-model per engine.** Ownership is explicit and 1:1 to avoid diffuse responsibility and to keep versioning boundaries clean.
- **Effects as data.** Engines return descriptors of effects; the Platform Kernel applies them. This keeps the audit trail complete and lets the Security Runtime veto effects before they leave the process.
- **Trace-first observability.** Not "add logging later" — every meaningful decision emits a structured trace event that the Trace Viewer consumes.
- **Conformance is testable.** Anyone can prove their engine implementation is compliant by running a fixed fixture set and comparing outputs.

## Considered Options

1. **Direct-effect engines** — each engine performs its own IO (DB writes, HTTP calls). **Rejected.** Breaks determinism, ruins testability, forces every engine to reimplement retry / transactionality, and gives the Security Runtime no chokepoint.
2. **Pure pipe/filter engines with no effect vocabulary** — engines return data only; the kernel guesses what to do next. **Rejected.** Cannot express "persist", "transition", "notify" without ambiguity, and forces business meaning into the kernel.
3. **Event-sourced engines with implicit dispatch** — engines emit domain events and a router figures out what happens next. **Rejected.** Fragments causal chains, makes trace lineage indirect, and complicates deterministic replay.
4. **Declarative effect descriptors returned by pure engines, applied by the kernel.** **Chosen.** Engines are pure and testable; the kernel owns all side effects; the Security Runtime sees every effect before application; trace lineage is a straight line from input → engine → effect → next engine.

## Decision

Adopt a **uniform engine contract** with pure execution, declarative effects, and mandatory trace-event emission.

### The Eight Engines and Their CAM Sub-Model (locked 1:1)

| Package | CAM sub-model owned | Primary responsibility |
|---|---|---|
| `runtime-interaction-ui` | `InteractionModel` | Render field trees, apply conditional visibility, enforce client-side validation |
| `runtime-workflow` | `WorkflowModel` | Execute state machines, evaluate guards, assign tasks, escalate |
| `runtime-rules` | `RuleModel` | Evaluate named rules, derive field state, compute sort/filter/display changes |
| `runtime-operations` | `OperationModel` | Dispatch semantic operations to adapters, enforce retry / idempotency |
| `runtime-data` | `DataModel` | Resolve entity persistence through data adapters |
| `runtime-integration` | `IntegrationModel` | Execute external calls through integration adapters |
| `runtime-security-policy` | `SecurityModel` | Evaluate RBAC + ABAC on every field access and every operation dispatch |
| `runtime-observability` | `ObservabilityModel` | Collect and emit trace events, metrics, and audit records |

No engine reads a sub-model outside its owned slot. Cross-sub-model information reaches an engine only through `ExecutionContext` values the kernel injects.

### Engine Interface

The reference language is TypeScript; the semantics are language-neutral.

```typescript
interface RuntimeEngine<TSubModel, TInput, TOutput> {
  readonly engineId: string;                 // e.g., "runtime-workflow"
  readonly engineVersion: string;            // semver of the engine implementation
  readonly camSubModelId: string;            // e.g., "WorkflowModel"
  readonly camSubModelVersionRange: string;  // semver range this engine accepts

  readonly capabilities: EngineCapabilityDeclaration;

  execute(
    subModel: TSubModel,
    input: TInput,
    context: ExecutionContext
  ): Promise<EngineResult<TOutput>>;
}

interface EngineResult<T> {
  output: T;
  effects: EffectDescriptor[];    // side effects the kernel will apply
  traceEvents: TraceEvent[];      // structured trace records emitted during execution
  diagnostics: Diagnostic[];      // non-fatal warnings and rejections
}

interface ExecutionContext {
  readonly appId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly principal: { userId: string; roleIds: string[]; attributes: Record<string, unknown> };
  readonly now: () => string;              // ISO 8601; injected — engines never call Date.now() directly
  readonly random: () => number;           // seeded; injected — engines never call Math.random() directly
  readonly featureFlags: Readonly<Record<string, boolean>>;
  readonly logger: TraceLogger;            // structured emitter — engines never write to stdout
}
```

### Determinism Contract

An engine is **deterministic** iff, given the same `(subModel, input, context)` tuple where `context.now` and `context.random` are seeded identically, `execute` returns byte-equivalent `EngineResult` (modulo the order of arrays that are explicitly documented as unordered).

Concretely:

- Engines **must not** call `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`, `process.env`, filesystem, or network APIs directly.
- Engines **must** obtain time and randomness from `context.now()` and `context.random()`.
- Engines **must not** import any AI/model SDK. Ever. The Platform Kernel and CI enforce this at build time.

### Effect Model

Engines never apply side effects. They return `EffectDescriptor[]`; the Platform Kernel applies them under Security/Policy Runtime supervision.

```typescript
type EffectDescriptor =
  | { type: 'persist'; entity: string; operation: 'upsert' | 'delete'; data: unknown; correlationId: string }
  | { type: 'emit'; eventName: string; payload: unknown; correlationId: string }
  | { type: 'notify'; channel: string; templateId: string; recipients: string[]; correlationId: string }
  | { type: 'transition'; stateMachineId: string; entityRef: string; toState: string; correlationId: string }
  | { type: 'dispatch-operation'; operationId: string; input: unknown; correlationId: string }
  | { type: 'schedule'; at: string; effect: Omit<EffectDescriptor, 'correlationId'>; correlationId: string };
```

Rules for effects:

- Every effect carries a `correlationId` linking it to the trace event that produced it.
- The Security Runtime evaluates every effect against the current `ExecutionContext.principal` before the kernel applies it. A denied effect becomes a `Diagnostic` on the next engine invocation, not an exception.
- Effects are applied atomically per engine invocation: either all succeed or none do (kernel-level transaction envelope).
- No engine may emit an effect targeting another engine's owned sub-model except via `dispatch-operation`.

### Trace Event Requirements

Every engine emits trace events for the decisions listed below. Trace events conform to the Trace Event JSON Schema (`docs/schemas/trace-event.v0.1.schema.json` — to be authored in WS-0.2).

| Engine | Must emit trace events for |
|---|---|
| UI Runtime | Field rendered (`fieldId`, `visible`, `required`, `valueHash`); visibility rule fired |
| Workflow Runtime | State entered / exited; guard evaluated (with `true`/`false` and reason); task assigned |
| Rules Runtime | Rule evaluated (`ruleId`, `conditionResult`); derived-field state change |
| Operations Runtime | Operation dispatched; adapter selected; result received; retry attempted |
| Data Runtime | Entity read / written; query executed; migration applied |
| Security Runtime | Permission check (`decision`, `subject`, `resource`, `policyId`); ABAC policy evaluated |
| Integration Runtime | External call attempted; adapter selected; response envelope hash |
| Observability Runtime | Aggregation computed; alert threshold crossed |

Trace event emission is not optional. A conformance test that shows an engine skipping a mandated event fails the engine.

### Failure Modes and Error Taxonomy

Engines classify all abnormal outcomes as `Diagnostic` entries. Only a truly catastrophic condition (kernel invariant violated) throws.

```typescript
interface Diagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;                    // e.g., "workflow.guard.failed", "rules.unknown-operator"
  message: string;
  path?: string;                   // JSON Pointer into the sub-model or input
  cause?: string;                  // upstream code chain
  suggestedRemediation?: string;
}
```

- `severity: 'error'` diagnostics abort the current engine invocation and are surfaced to the Trace Viewer with full lineage.
- Engines never catch exceptions silently. Any caught exception becomes a `severity: 'error'` diagnostic.

### Capability Declaration

Engines declare capabilities so the kernel can negotiate at load time:

```typescript
interface EngineCapabilityDeclaration {
  supportedCamSubModelVersions: string;      // semver range
  supportedOperationKinds?: string[];        // e.g., rules engine advertising ['boolean', 'comparison', 'string']
  parallelExecution: boolean;                // may the kernel batch calls?
  transactional: boolean;                    // does the engine require a transaction envelope?
  deterministic: true;                       // MUST be true — non-deterministic engines are rejected at load
}
```

`deterministic: true` is a load-time invariant. There is no non-deterministic engine.

### Conformance Suite

Every engine package includes a `conformance/` directory:

```
packages/runtime-<name>/
  conformance/
    fixtures/           # CAM sub-model + input pairs covering all capability tiers
    expectations/       # expected EngineResult for each fixture
    conformance.test.ts # runs every fixture through the engine and diffs against expectation
```

Any alternative engine implementation (Rust, WASM, Go) is certified by running the same fixture set and matching all expectations. The fixture set is versioned alongside the CAM sub-model schema.

### What Engines Must NOT Do

- No direct HTTP, database, filesystem, or process calls. Use `EffectDescriptor`.
- No AI/model SDK imports. Enforced by ESLint rule + build-time bytecode scan.
- No reading of BIM or AIM — only the engine's assigned CAM sub-model.
- No `console.log` / `stdout` writes. Use `context.logger.trace(...)`.
- No caching across `execute` invocations except through `ExecutionContext`-provided facilities.
- No throwing for expected failure modes — return `Diagnostic` instead.

## Consequences

**Positive:**

- Engines are unit-testable without any infrastructure. A fixture is enough.
- The Trace Viewer's "why did this happen?" question has a single, uniform answer surface across all engines.
- Alternative implementations (Rust hot-path rules engine, WASM sandboxed adapters) can be plugged in with confidence — the conformance suite proves equivalence.
- Security/Policy has a single chokepoint for every effect, aligning with the field-level ABAC principle in the platform baseline.
- Determinism guarantees make replay and reproducibility straightforward — critical for governance audits and incident forensics.

**Negative / Costs:**

- Engine authors cannot take shortcuts (e.g., "just call the DB here"). Every side effect must round-trip through the kernel.
- The kernel becomes a larger, more central component. Its own correctness and performance are on the critical path.
- The `EffectDescriptor` union is stable-by-design, so adding new effect kinds is an ADR-worthy event.
- Injected `now` and `random` create a small ergonomic tax on engine authors, especially those porting existing code.

**Neutral:**

- Requires a shared TypeScript package (`@appbana/engine-contract`) exporting the interfaces and effect union. TypeScript types are generated from JSON Schemas for `TraceEvent`, `EffectDescriptor`, and `Diagnostic`.

## Compliance / Validation

- **Build-time linter** — a repository-wide ESLint rule bans imports of AI SDKs, direct IO calls, `Date.now`, `Math.random`, and `console.*` from any `packages/runtime-*` package. CI fails on violation.
- **Load-time gate** — the Platform Kernel refuses to load an engine whose `capabilities.deterministic` is not `true` or whose `camSubModelVersionRange` does not cover the loaded CAM.
- **Conformance suite** — every `packages/runtime-*` package must ship a passing `conformance.test.ts`. CI enforces its presence and its green status.
- **Trace-event completeness test** — a CI job replays a canonical fixture and asserts that all mandated trace events per the table above are present.
- **Effect-audit test** — for every engine, a CI job asserts that all effects returned from `execute` are members of the declared `EffectDescriptor` union — no ad-hoc effect shapes.
- **Reference example** — the Customer Onboarding CAM (once authored) must execute end-to-end through the reference engines with a byte-identical trace on repeat runs.

## References

- [architecture.md § 10 — AppBana Platform Kernel](../../architecture.md)
- [architecture.md § 11 — Runtime Engines](../../architecture.md)
- [ADR-011 — BIM vs AIM Boundary](ADR-011-bim-aim-boundary.md)
- [ADR-012 — CAM Versioning (pending)](ADR-012-canonical-application-model-versioning.md)
- [ADR-014 — Technology Adapter Contract (pending)](ADR-014-technology-adapter-contract.md)
- [Runtime Engine Instructions](../../.github/instructions/runtime-engines.instructions.md)
- [execution-plan.md — Phase 0 WS-0.1 / Phase 1](../../execution-plan.md)
