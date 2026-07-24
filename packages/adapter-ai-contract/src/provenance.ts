/**
 * AI provenance record — the audit contract for every model call.
 *
 * Traces to ADR-015 § *Provenance Record — Mandatory on Every Call*. This record is
 * **required** on every {@link import("./adapter.js").AIInvocationResult}, including
 * failures. Nothing in the platform may consume a model output whose provenance is
 * missing or invalid; the ADR-017 governance gate (`check.ai-governance`) refuses
 * activation of any CAM whose latest AI-generated changes lack it.
 *
 * ## Version history
 *
 * - `0.2` (2026-07-25) — added required `tenantId` field so cost aggregation,
 *   per-tenant retention, and enterprise multi-tenancy can key on provenance.
 * - `0.1` (2026-07-24) — initial Phase 0 schema.
 */

/** Wire version of the provenance record. Bump = ADR-015 amendment. */
export const AI_PROVENANCE_VERSION = "0.2" as const;

/** Redaction actions permitted before request inputs cross the adapter boundary. */
export const aiRedactionActions = ["removed", "masked", "hashed", "truncated"] as const;
export type AIRedactionAction = (typeof aiRedactionActions)[number];

/** Human-review status per ADR-017 `check.ai-governance`. */
export const aiHumanReviewStatuses = [
  "pending",
  "approved",
  "rejected",
  "not-required",
] as const;
export type AIHumanReviewStatus = (typeof aiHumanReviewStatuses)[number];

export interface AIProvenanceRedaction {
  /** JSON Pointer into the request inputs describing what was redacted. */
  readonly path: string;
  /** Data classification label from the tenant's SecurityModel `dataClassifications`. */
  readonly classification: string;
  readonly action: AIRedactionAction;
  /** Reference back to the policy that triggered the redaction, when applicable. */
  readonly policyRef?: string;
}

export interface AIProvenanceHumanReview {
  readonly required: boolean;
  readonly status: AIHumanReviewStatus;
  /** Opaque subject id of the reviewer. MUST NOT contain raw PII. */
  readonly reviewerId?: string;
  /** ISO-8601 UTC timestamp of the review decision. */
  readonly reviewedAt?: string;
}

export interface AITokenUsage {
  readonly input: number;
  readonly output: number;
  readonly total: number;
}

export interface AIProvenanceRecord {
  /** Envelope version, currently `"0.2"`. */
  readonly aiProvenanceVersion: typeof AI_PROVENANCE_VERSION;

  /**
   * Tenant that owns the invocation, echoed from `AIInvocationContext.tenantId`.
   * Required so cost aggregation, retention policies, and
   * tenant-scoped queries can key on the record without joining against another
   * table. Opaque string; never contains raw PII.
   */
  readonly tenantId: string;

  /** Adapter binding, e.g. `"ai:anthropic-claude"`. */
  readonly modelBinding: string;
  /** Vendor-canonical model name, e.g. `"claude-sonnet-4-5"`. */
  readonly modelName: string;
  readonly modelVersion: string;
  /** Region where the call was actually served (may narrow the capability's `dataResidencyGuarantee`). */
  readonly modelProviderRegion?: string;

  /**
   * Prompt template ref in the bare form `prompt.<agent>.<task>` — do NOT append a
   * `:v<n>` suffix. The version lives separately in `promptTemplateVersion` so
   * `@appbana/prompt-template-registry`'s `${ref}@${version}` lookup key resolves.
   * Example: `"prompt.ba-agent.intake"`.
   */
  readonly promptTemplateRef: string;
  /** Prompt template semver, e.g. `"1.0.0"`. */
  readonly promptTemplateVersion: string;
  /** `sha256:<hex>` of the resolved prompt text (post-variable-substitution). */
  readonly promptTemplateHash: string;

  /** `sha256:<hex>` of the canonicalized request inputs. */
  readonly inputHash: string;
  /** `sha256:<hex>` of the raw model output (pre-schema-validation). */
  readonly outputHash: string;

  readonly tokenUsage: AITokenUsage;

  /** Adapter-observed wall-clock latency in milliseconds. */
  readonly wallClockMs: number;
  /** ISO-8601 UTC timestamp of the outbound request. */
  readonly requestedAt: string;
  /** ISO-8601 UTC timestamp when the adapter finalized the result. */
  readonly completedAt: string;

  /** Requesting agent id, e.g. `"agent.ba-agent"`, `"agent.normalization"`. */
  readonly requestingAgent: string;

  readonly humanReview?: AIProvenanceHumanReview;

  /** Redactions applied to inputs *before* any network call. Empty array = nothing redacted. */
  readonly redactions: readonly AIProvenanceRedaction[];
}
