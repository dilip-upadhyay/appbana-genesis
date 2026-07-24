/**
 * Public types for the Normalization Agent.
 *
 * The agent is a thin, deterministic orchestrator:
 *   1. Loads the versioned `prompt.normalization-agent.bim-to-aim` template from
 *      the injected `PromptRegistry`.
 *   2. Canonicalizes the BIM into a stable string + `bimContentHash`.
 *   3. Invokes the injected `AIModelAdapter` with a `json-schema` response
 *      contract (the AIM schema is injected too — the agent does NOT own it).
 *   4. Validates the returned artifact against the AIM schema via the injected
 *      `aimValidator` function.
 *   5. Detects `[UNRESOLVED]` sentinels the prompt tells the model to emit when
 *      a required AIM field cannot be derived from the BIM.
 *   6. Records the provenance record produced by the adapter into the injected
 *      `AIProvenanceStore` and returns the store id.
 *
 * Every field on {@link NormalizeBimResult} is derivable from the same
 * (bim, tenant, adapter, registry, schema) tuple, which makes the agent behave
 * as a pure function of its inputs (given a deterministic adapter).
 */

import type {
  AIBudget,
  AITokenUsage,
} from "@appbana/adapter-ai-contract";

/** Opaque BIM document. The agent never inspects its shape. */
export type BimDocument = Readonly<Record<string, unknown>>;

/** Opaque AIM document. Post-validation shape. */
export type AimDocument = Readonly<Record<string, unknown>>;

/**
 * Outcomes surfaced by {@link normalizeBim}. Nested-error causes (network
 * failure, safety refusal, budget breach) are folded into an `ai-*` prefix so
 * the caller only ever branches on one enum.
 */
export type NormalizeBimOutcome =
  | "produced"
  | "schema-invalid"
  | "unresolved-fields"
  | "ai-refused"
  | "ai-budget-exceeded"
  | "ai-failed";

export interface NormalizeDiagnostic {
  /** Stable machine-readable code (`NORMALIZATION_*` or forwarded from adapter). */
  readonly code: string;
  /** JSON Pointer into the AIM candidate, when applicable. */
  readonly path?: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly detail?: unknown;
}

export interface AimValidationError {
  readonly path: string;
  readonly message: string;
  readonly keyword?: string;
  readonly detail?: unknown;
}

export interface AimValidationResult {
  readonly valid: boolean;
  readonly errors: readonly AimValidationError[];
}

/** Function form of an AIM schema validator; caller may plug in Ajv or any other engine. */
export type AimValidator = (candidate: unknown) => AimValidationResult;

export interface NormalizeBimInput {
  readonly bim: BimDocument;
  /** Tenant that owns the invocation. Echoed to provenance v0.2 and prompt inputs. */
  readonly tenantId: string;
  /** Human-readable tenant name substituted into the prompt (`{{tenantName}}`). */
  readonly tenantName: string;
  /** UUID correlation id echoed to provenance + trace events. */
  readonly correlationId: string;
  /**
   * Per-call budget. `maxCostUsd` only enforced when the adapter's capabilities
   * declare cost coefficients (see `AIAdapterCapabilities`).
   */
  readonly budget?: AIBudget;
  /** Cooperative cancellation. Forwarded to the adapter's invocation context. */
  readonly abortSignal?: AbortSignal;
  /**
   * Optional override — defaults to `"prompt.normalization-agent.bim-to-aim"`.
   * Override only when running an A/B or migration prompt.
   */
  readonly promptRef?: string;
  /** Optional prompt version override — defaults to `"1.0.0"`. */
  readonly promptVersion?: string;
}

export interface NormalizeBimResult {
  readonly outcome: NormalizeBimOutcome;
  /** Present only when `outcome === "produced"`. */
  readonly aim?: AimDocument;
  readonly diagnostics: readonly NormalizeDiagnostic[];
  /** Resolved prompt ref (post override). */
  readonly promptRef: string;
  /** Resolved prompt version (post override). */
  readonly promptVersion: string;
  /** `sha256:<hex>` of the source prompt template body. */
  readonly promptTemplateHash: string;
  /** `sha256:<hex>` of the fully rendered prompt text. */
  readonly renderedPromptHash: string;
  /** `sha256:<hex>` of canonicalized BIM bytes. */
  readonly bimContentHash: string;
  readonly ai: {
    /** Store id assigned by the provenance store on `record()`. */
    readonly provenanceId: string;
    /** Verbatim adapter outcome. */
    readonly adapterOutcome: string;
    readonly wallClockMs: number;
    readonly tokenUsage: AITokenUsage;
    readonly correlationId: string;
  };
}

/**
 * Sentinel the prompt instructs the model to emit inside any AIM field the
 * model could not derive from the BIM. Detected at any depth of the AIM.
 */
export const UNRESOLVED_SENTINEL = "[UNRESOLVED]" as const;
