/**
 * @appbana/adapter-ai-contract
 *
 * Barrel export. Downstream packages MUST import from this entry point only —
 * deep imports into `./adapter.js`, `./capabilities.js`, etc. are unsupported.
 *
 * @see docs/adr/ADR-015-ai-model-adapter-layer.md
 */

/** Contract semver. Bumps follow the same rules as ADR-015 amendments. */
export const AI_ADAPTER_CONTRACT_VERSION = "0.1.0" as const;

export type {
  AIAdapterInvocationOutcome,
  AIInvocationChunk,
  AIInvocationResult,
  AIModelAdapter,
} from "./adapter.js";

export {
  aiCapabilityKinds,
  aiResponseContractKinds,
} from "./capabilities.js";
export type {
  AIAdapterCapabilities,
  AICapabilityKind,
  AIConformanceTier,
  AIResponseContractKind,
} from "./capabilities.js";

export type { AIAdapterConfig, AIAdapterInitContext } from "./config.js";

export type { Diagnostic, DiagnosticSeverity } from "./diagnostic.js";

export type { AIAdapterHealth, AIAdapterHealthState } from "./health.js";

export type {
  AIBudget,
  AIInvocationContext,
  AIInvocationRequest,
  AIRequestingAgent,
  AIResponseContract,
} from "./invocation.js";

export {
  AI_PROVENANCE_VERSION,
  aiHumanReviewStatuses,
  aiRedactionActions,
} from "./provenance.js";
export type {
  AIHumanReviewStatus,
  AIProvenanceHumanReview,
  AIProvenanceRecord,
  AIProvenanceRedaction,
  AIRedactionAction,
  AITokenUsage,
} from "./provenance.js";
