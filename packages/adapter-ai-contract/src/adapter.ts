/**
 * The `AIModelAdapter` interface every AI adapter package implements.
 *
 * Traces to ADR-015 § *The `AIModelAdapter` Interface*. See the ADR for the
 * rationale behind the artifact-not-effect contract and why this interface is
 * intentionally distinct from the technology adapter contract (ADR-014).
 */

import type {
  AIAdapterCapabilities,
  AICapabilityKind,
} from "./capabilities.js";
import type { AIAdapterConfig, AIAdapterInitContext } from "./config.js";
import type { Diagnostic } from "./diagnostic.js";
import type { AIAdapterHealth } from "./health.js";
import type {
  AIInvocationContext,
  AIInvocationRequest,
} from "./invocation.js";
import type { AIProvenanceRecord } from "./provenance.js";

/**
 * Adapter outcome enum. Adapters MUST NOT throw for these expected states —
 * exceptions are reserved for programmer errors.
 *
 * - `accepted` — the artifact validates against the response contract.
 * - `schema-invalid` — the model returned something but it did not conform.
 * - `refused` — a safety, policy, or content-filter refusal from the model.
 * - `budget-exceeded` — the invocation would have exceeded the declared budget.
 * - `failed` — upstream error (network, quota, 5xx). See `diagnostics` for the code.
 */
export type AIAdapterInvocationOutcome =
  | "accepted"
  | "schema-invalid"
  | "refused"
  | "budget-exceeded"
  | "failed";

export interface AIInvocationResult {
  readonly outcome: AIAdapterInvocationOutcome;
  /**
   * The model artifact. Present only when `outcome === "accepted"`; validated
   * against the request's `responseContract` before being returned.
   */
  readonly artifact?: unknown;
  readonly diagnostics: readonly Diagnostic[];
  /** MANDATORY. Populated for every outcome, including failures. */
  readonly provenance: AIProvenanceRecord;
  /**
   * Trace events emitted by the adapter. MUST include at least one
   * `event.ai.invoked` event. Kernel forwards to the observability pipeline.
   * Typed as `unknown[]` to avoid a Phase-1 dependency on the Trace Event package;
   * runtime shape is fixed by `docs/schemas/trace-event.v0.1.schema.json`.
   */
  readonly traceEvents: readonly unknown[];
  /** Echoed from the invocation request. */
  readonly correlationId: string;
}

/**
 * Streaming chunk emitted by adapters that declare `supportsStreaming: true`.
 * Each stream is terminated by exactly one chunk with `terminal: true`; that
 * terminal chunk carries the final `provenance` and `outcome`.
 */
export interface AIInvocationChunk {
  readonly correlationId: string;
  readonly terminal: boolean;
  /** Incremental artifact fragment; shape depends on the response contract. */
  readonly delta?: unknown;
  /** Present only on the terminal chunk. */
  readonly outcome?: AIAdapterInvocationOutcome;
  /** Present only on the terminal chunk. */
  readonly provenance?: AIProvenanceRecord;
  /** Optional per-chunk diagnostics. */
  readonly diagnostics?: readonly Diagnostic[];
}

/**
 * The one interface every AI adapter package exports (as default export).
 *
 * @typeParam TCapability - Narrowing type parameter that pins the adapter to a
 *   single capability kind. Multi-capability adapter packages export multiple
 *   classes, one per kind.
 */
export interface AIModelAdapter<
  TCapability extends AICapabilityKind = AICapabilityKind,
> {
  /** Adapter kind. MUST match `capabilities.kind`. */
  readonly kind: TCapability;
  /** Binding string used to match the deployment routing policy, e.g. `"ai:anthropic-claude"`. */
  readonly binding: string;

  /** Static capability declaration. Read at kernel startup; never mutated. */
  readonly capabilities: AIAdapterCapabilities;

  /**
   * Called exactly once at kernel startup, after config load, before any `invoke()`.
   * Establish pools, verify credentials, warm caches, load local model weights.
   * Init failures block the entire kernel from starting.
   */
  init(config: AIAdapterConfig, ctx: AIAdapterInitContext): Promise<void>;

  /**
   * Called on every agent invocation the kernel routes to this adapter.
   * MUST NOT throw for the outcomes enumerated in {@link AIAdapterInvocationOutcome} —
   * report them via `outcome` + `diagnostics` instead. Exceptions are treated as
   * programmer errors and will surface in the operator dashboard.
   */
  invoke(
    request: AIInvocationRequest,
    ctx: AIInvocationContext,
  ): Promise<AIInvocationResult>;

  /**
   * Optional streaming invocation. Present iff `capabilities.supportsStreaming === true`.
   * The final yielded chunk MUST carry the completed provenance record.
   */
  invokeStream?(
    request: AIInvocationRequest,
    ctx: AIInvocationContext,
  ): AsyncIterable<AIInvocationChunk>;

  /** Called at graceful shutdown. Close connections, unload weights, flush buffers. */
  shutdown(): Promise<void>;

  /** Health probe consumed by the platform readiness endpoint. */
  health(): Promise<AIAdapterHealth>;
}
