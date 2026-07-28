// @appbana/engine-contract — the RuntimeEngine interface (ADR-013).
//
// This is the executable form of the contract. Before this file existed the
// determinism guarantee, the purity invariant, and the effect model lived only
// as prose in ADR-013 — nothing prevented an engine author from ignoring them.

import type { Diagnostic } from "./diagnostic.js";
import type { EffectDescriptor } from "./effect.js";
import type { Json } from "./json.js";
import type { EngineId, TraceEvent } from "./trace-event.js";

/**
 * Structured trace emitter handed to engines.
 *
 * Engines never write to stdout. `trace()` accumulates into the
 * `EngineResult.traceEvents` array the kernel collects — it does not perform
 * IO, which is what keeps `execute()` pure.
 */
export interface TraceLogger {
  trace(event: TraceEvent): void;
}

export interface EnginePrincipal {
  readonly userId: string;
  readonly roleIds: readonly string[];
  readonly attributes: Readonly<Record<string, Json>>;
}

/**
 * Everything an engine is allowed to know beyond its own sub-model and input.
 *
 * Note what is absent: no database handle, no HTTP client, no filesystem, no
 * model client. The absence is the contract. An engine that needs any of those
 * is expressing an effect, and effects are returned as data.
 */
export interface ExecutionContext {
  readonly appId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly principal: EnginePrincipal;
  /** ISO 8601. Injected — engines never call `Date.now()` (ADR-013). */
  readonly now: () => string;
  /** Seeded — engines never call `Math.random()` (ADR-013). */
  readonly random: () => number;
  readonly featureFlags: Readonly<Record<string, boolean>>;
  readonly logger: TraceLogger;
}

export interface EngineResult<T> {
  readonly output: T;
  /** Side effects the kernel will apply. The engine applies none of them. */
  readonly effects: readonly EffectDescriptor[];
  readonly traceEvents: readonly TraceEvent[];
  /** Non-fatal warnings and rejections. Expected failures live here, not in exceptions. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface EngineCapabilityDeclaration {
  /** semver range of CAM sub-model versions this engine accepts. */
  readonly supportedCamSubModelVersions: string;
  /** e.g. a rules engine advertising ['boolean', 'comparison', 'string']. */
  readonly supportedOperationKinds?: readonly string[];
  /** May the kernel batch calls? */
  readonly parallelExecution: boolean;
  /** Does the engine require a transaction envelope? */
  readonly transactional: boolean;
  /**
   * MUST be `true`. Typed as the literal so a non-deterministic engine is a
   * compile error, not merely a load-time rejection. ADR-013: "There is no
   * non-deterministic engine."
   */
  readonly deterministic: true;
  /**
   * Maps each mandated trace decision (see `MANDATED_TRACE_DECISIONS`) to the
   * concrete `event.*` kind ref this engine emits for it. The conformance
   * suite verifies every mandated decision is mapped and actually observed.
   */
  readonly traceDecisionKinds: Readonly<Record<string, string>>;
}

/**
 * The uniform contract every runtime engine implements.
 *
 * `execute` must be a pure function of `(subModel, input, context)`. It is
 * declared `Promise`-returning because ADR-013 specifies it so — but an engine
 * that awaits IO inside it violates the contract, and the conformance suite's
 * determinism and purity checks are designed to catch exactly that.
 */
export interface RuntimeEngine<TSubModel, TInput, TOutput> {
  /** e.g. "runtime-workflow". Constrained to the eight locked engine ids. */
  readonly engineId: EngineId;
  /** semver of the engine implementation. */
  readonly engineVersion: string;
  /** e.g. "WorkflowModel". Must equal `ENGINE_SUB_MODEL[engineId]`. */
  readonly camSubModelId: string;
  /** semver range of sub-model versions accepted. */
  readonly camSubModelVersionRange: string;

  readonly capabilities: EngineCapabilityDeclaration;

  execute(
    subModel: TSubModel,
    input: TInput,
    context: ExecutionContext,
  ): Promise<EngineResult<TOutput>>;
}

/** Any engine, for heterogeneous kernel-side collections. */
export type AnyRuntimeEngine = RuntimeEngine<never, never, unknown>;
