/**
 * AI invocation request / context / budget shapes.
 *
 * Traces to ADR-015 § *The `AIModelAdapter` Interface* and § *Budgets, Rate Limits,
 * and Back-Pressure*. The kernel constructs these on behalf of agents; adapters never
 * construct them.
 */

/** Requesting agent identifier. Used in provenance + trace-event correlation. */
export type AIRequestingAgent =
  | "agent.ba-agent"
  | "agent.normalization"
  | "agent.cam-generator"
  | "agent.validation"
  | "agent.domain-modeler"
  | "agent.change-impact"
  // Open-ended: new agents may be introduced without breaking this contract.
  | (string & { readonly __agentIdBrand?: never });

/**
 * The shape the caller expects from the model. `free-text` returns raw string
 * content; the structured kinds return schema-conformant JSON that the adapter is
 * responsible for producing (and, where the underlying API supports it, constraining).
 */
export type AIResponseContract =
  | { readonly kind: "free-text" }
  | {
      readonly kind: "json-schema";
      /** JSON Schema (Draft 2020-12) describing the required output shape. */
      readonly schema: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "tool-use";
      /** Reference into the tool catalog; adapter resolves. */
      readonly toolCatalogRef: string;
    }
  | { readonly kind: "embedding-vector"; readonly dimensions: number }
  | { readonly kind: "transcript"; readonly languageHint?: string };

/**
 * Per-call budget. Adapters MUST enforce and, on breach, return
 * `outcome: "budget-exceeded"` with a populated provenance record — never exceed.
 */
export interface AIBudget {
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxWallClockMs?: number;
  /**
   * Cost cap in USD. Enforced only when the adapter's capabilities declare
   * `costPerInputToken` / `costPerOutputToken`.
   */
  readonly maxCostUsd?: number;
}

export interface AIInvocationRequest {
  readonly promptTemplateRef: string;
  readonly promptTemplateVersion: string;

  /** Template variables. Canonicalized and hashed for the provenance record's `inputHash`. */
  readonly inputs: Readonly<Record<string, unknown>>;

  readonly responseContract: AIResponseContract;

  readonly budget: AIBudget;

  /** Tool catalog id for models that support tool calling. */
  readonly toolCatalogRef?: string;

  /**
   * Optional determinism hint. Adapters MAY ignore; capabilities declare support
   * via `supportsDeterminismHint`.
   */
  readonly seed?: number;

  /** Echoed to the provenance record and trace events. UUID format expected. */
  readonly correlationId: string;

  readonly requestingAgent: AIRequestingAgent;
}

/**
 * Per-invocation context passed by the kernel. Carries the tenant + trace-context
 * needed for redaction and trace-event emission.
 */
export interface AIInvocationContext {
  readonly tenantId: string;
  readonly appId: string;
  readonly camId: string;
  readonly camVersion: string;
  readonly environment: "dev" | "staging" | "canary" | "prod";
  readonly region?: string;

  /** W3C trace context — echoed to any emitted trace events. */
  readonly traceContext: {
    readonly traceId: string;
    readonly spanId: string;
    readonly parentSpanId?: string;
  };

  /** Abort signal honored by well-behaved adapters (cancellation, deadline expiry). */
  readonly signal?: AbortSignal;

  /** Deterministic clock injected by the kernel. Adapters SHOULD use this for provenance timestamps. */
  readonly now: () => Date;
}
