---
description: "Use when implementing, modifying, or testing runtime engines (UI, Workflow, Rules, Operations, Data, Integration, Security/Policy, Observability). Covers the engine contract, determinism requirement, CAM sub-model ownership, effect model, conformance tests, and trace event rules."
applyTo: "packages/runtime-*/**,packages/platform-kernel/**"
---

# Runtime Engine Instructions

## Core Rule: Engines Are Deterministic — No AI

Runtime engines execute the Canonical Application Model. They must be:
- **Deterministic** — same CAM + same inputs → same outputs, always.
- **AI-free** — no model calls inside any runtime engine, ever.
- **Traceable** — every meaningful action emits a trace event.
- **Stateless per request** — state lives in the Platform Kernel's session layer, not inside engines.

## The Eight Engines and Their CAM Sub-Model

| Package | CAM Sub-model | Primary responsibility |
|---|---|---|
| `runtime-interaction-ui` | `InteractionModel` | Render field trees, apply conditional visibility, enforce client-side validation |
| `runtime-workflow` | `WorkflowModel` | Execute state machines, evaluate guards, assign tasks, escalate |
| `runtime-rules` | `RuleModel` | Evaluate named rules, derive field state, compute sort/filter/display changes |
| `runtime-operations` | `OperationModel` | Dispatch semantic operations to adapters, enforce retry/idempotency |
| `runtime-data` | `DataModel` | Resolve entity persistence operations through data adapters |
| `runtime-integration` | `IntegrationModel` | Execute external calls through integration adapters |
| `runtime-security-policy` | `SecurityModel` | Evaluate RBAC + ABAC on every field access and operation dispatch |
| `runtime-observability` | `ObservabilityModel` | Collect and emit trace events, metrics, audit records |

## Engine Contract (every engine must implement)

```typescript
interface RuntimeEngine<TSubModel, TInput, TOutput> {
  // Declared capabilities — kernel negotiates with adapters based on this
  readonly capabilities: EngineCapabilityDeclaration;

  // Pure execution — no side effects except through EffectDescriptors
  execute(
    subModel: TSubModel,
    input: TInput,
    context: ExecutionContext
  ): Promise<EngineResult<TOutput>>;
}

interface EngineResult<T> {
  output: T;
  effects: EffectDescriptor[];   // side effects to be applied by kernel
  traceEvents: TraceEvent[];     // all trace events produced during execution
  diagnostics: Diagnostic[];     // non-fatal warnings
}
```

## Effect Model

Engines do **not** apply side effects directly. They return `EffectDescriptor[]` which the Platform Kernel applies:

```typescript
type EffectDescriptor =
  | { type: 'persist'; entity: string; operation: 'upsert' | 'delete'; data: unknown }
  | { type: 'emit'; eventName: string; payload: unknown }
  | { type: 'notify'; channel: string; templateId: string; recipients: string[] }
  | { type: 'transition'; stateMachineId: string; toState: string }
  | { type: 'dispatch-operation'; operationId: string; input: unknown };
```

This keeps engines pure and testable — you can unit-test an engine without a database or message bus.

## Trace Event Requirements

Every engine must emit trace events for:

| Engine | Must trace |
|---|---|
| UI Runtime | Field rendered (fieldId, visible, required, value), visibility rule fired |
| Workflow Runtime | State entered/exited, guard evaluated (true/false), task assigned |
| Rules Runtime | Rule evaluated, condition result, derived state change |
| Operations Runtime | Operation dispatched, adapter selected, result received, retry attempted |
| Data Runtime | Entity read/written, query executed, migration applied |
| Security Runtime | Permission check (allow/deny), ABAC policy evaluated |
| Observability Runtime | Aggregation computed, alert threshold crossed |

Trace event schema: `docs/schemas/trace-event.v0.1.schema.json`.

## Conformance Tests

Every engine package must include a `conformance/` directory with:
- `fixtures/` — CAM sub-model samples covering all capability tiers
- `expectations/` — expected `EngineResult` for each fixture
- `conformance.test.ts` — runs every fixture through the engine and diffs against expectation

This allows any alternative implementation (e.g., Rust engine, WASM engine) to run the same fixture set and be certified as conformant.

## Rules Engine — Special Notes

- Only the operations in `RuleModel` may be evaluated. No arbitrary expressions.
- Phase 2 rule vocabulary: boolean logic, comparisons, string operations.
- Phase 3 additions: arithmetic (amount thresholds, aggregations), temporal comparisons, hierarchical policy inheritance.
- Never evaluate a rule expression that wasn't declared in the CAM. Reject unknown rule types with a `Diagnostic`, not a runtime error.

## Workflow Engine — Special Notes

- State machine transitions must be atomic from the Platform Kernel's perspective.
- A guard failure must produce a `Diagnostic` explaining which condition failed (for Trace Viewer).
- Delegation and impersonation require explicit entries in the `WorkflowModel.delegationPolicies` — they cannot be injected at runtime.

## Security Runtime — Special Notes

- Evaluated on **every** field access and **every** operation dispatch. Zero exceptions.
- ABAC policies are evaluated against the execution context identity + field classification + operation sensitivity.
- A deny result never throws — it returns a `PermissionDenied` effect that the kernel converts to a masked field or a 403 operation result.
- Never cache permission decisions beyond the current request boundary.

## What NOT to Do in Engines

- Do not make HTTP calls, database calls, or filesystem calls directly — use effect descriptors.
- Do not import any AI model SDK.
- Do not read BIM or AIM — only the assigned CAM sub-model.
- Do not log to stdout — emit trace events instead.
- Do not catch exceptions silently — surface as `Diagnostic` entries with severity `error`.
