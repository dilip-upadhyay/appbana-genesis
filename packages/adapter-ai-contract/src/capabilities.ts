/**
 * AI adapter capability declaration and kind enumeration.
 *
 * Traces to ADR-015 § *The Five AI Adapter Kinds (v0.1)* and § *Capability Declaration*.
 * Every registered AI adapter exposes an `AIAdapterCapabilities` instance which the
 * kernel reads at load time to enforce deployment-mode invariants (ADR-016) and to
 * gate downstream governance checks (ADR-017 `check.ai-governance`).
 */

/** The v0.1 AI capability kinds. Adding a kind requires an ADR-015 amendment. */
export const aiCapabilityKinds = [
  "text-generation",
  "structured-output",
  "embedding",
  "speech-to-text",
  "vision",
] as const;

export type AICapabilityKind = (typeof aiCapabilityKinds)[number];

/**
 * The response contracts an adapter may support. Matched against
 * {@link import("./invocation.js").AIResponseContract.kind} on every request.
 */
export const aiResponseContractKinds = [
  "free-text",
  "json-schema",
  "tool-use",
  "embedding-vector",
  "transcript",
] as const;

export type AIResponseContractKind = (typeof aiResponseContractKinds)[number];

/**
 * Conformance tier declared by the adapter after passing the corresponding
 * `@appbana/ai-adapter-conformance-suite` profile.
 *
 * - `C` — Runnable: basic invoke/init/shutdown/health + valid provenance.
 * - `B` — Production-viable: adds concurrency, rate-limit respect, budget enforcement,
 *         schema-validation under partial output, graceful degradation.
 * - `A` — Regulated-workload: adds redaction enforcement, data-residency verification,
 *         prompt-hash stability, human-review gate enforcement.
 */
export type AIConformanceTier = "A" | "B" | "C";

export interface AIAdapterCapabilities {
  /** MUST match the adapter's `kind` field. */
  readonly kind: AICapabilityKind;
  /** MUST match the adapter's `binding` field, e.g. `"ai:anthropic-claude"`. */
  readonly binding: string;

  /** Vendor-canonical model name, e.g. `"claude-sonnet-4-5"`, `"llama-3.3-70b-instruct"`. */
  readonly modelName: string;
  /** Vendor-published model version string. Included in every provenance record. */
  readonly modelVersion: string;
  /**
   * Region where model calls are served. Absent = no guarantee.
   * Enforced against `tenantAIPolicy.dataResidencyRequired` at kernel load.
   */
  readonly modelProviderRegion?: string;

  /** Response contracts this adapter can satisfy. */
  readonly supportedResponseContracts: readonly AIResponseContractKind[];

  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;

  readonly supportsStreaming: boolean;
  readonly supportsToolUse: boolean;
  /** True if the underlying API exposes a native structured / JSON mode. */
  readonly supportsStructuredOutput: boolean;
  /** True if the adapter honors the `seed` field on requests. */
  readonly supportsDeterminismHint: boolean;

  /** MUST be `false` for adapters usable in air-gapped deployment mode. */
  readonly requiresNetwork: boolean;
  /**
   * True iff request inputs (post-redaction) egress to a third-party model provider.
   * Enforced against `tenantAIPolicy.allowThirdPartyModelEgress` at kernel load.
   */
  readonly egressesInputsToThirdParty: boolean;
  /** Region guarantee for served calls; matched against tenant policy. */
  readonly dataResidencyGuarantee?: string;

  /** Optional cost hints (USD per token) used for budget enforcement. */
  readonly costPerInputToken?: number;
  readonly costPerOutputToken?: number;
  readonly rateLimitTokensPerMinute?: number;

  readonly conformanceTier: AIConformanceTier;

  /** Semver of this adapter package, independent of the platform. */
  readonly adapterVersion: string;
  /** Minimum platform-kernel semver this adapter requires. */
  readonly minPlatformKernelVersion: string;
}
