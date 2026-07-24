/**
 * Shared capability declarations for the two Claude adapters. Kept in one
 * place so the manifest fixture (examples/customer-onboarding/ai-adapter-manifests/anthropic-claude.manifest.json)
 * and the runtime capabilities never drift.
 */

import type { AIAdapterCapabilities } from "@appbana/adapter-ai-contract";

export const CLAUDE_ADAPTER_VERSION = "0.1.0" as const;
export const CLAUDE_MIN_PLATFORM_KERNEL_VERSION = "0.1.0" as const;

/** Vendor-canonical model name used by both adapters. */
export const DEFAULT_CLAUDE_MODEL_NAME = "claude-sonnet-4-5" as const;

/** Anthropic-published model version string, e.g. `"2026-06"`. */
export const DEFAULT_CLAUDE_MODEL_VERSION = "2026-06" as const;

export const CLAUDE_TEXT_GENERATION_BINDING = "ai:anthropic-claude" as const;
export const CLAUDE_STRUCTURED_OUTPUT_BINDING =
  "ai:anthropic-claude-json" as const;

interface BaseCapInput {
  readonly modelName: string;
  readonly modelVersion: string;
  readonly region: string;
}

export function buildTextGenerationCapabilities(
  input: BaseCapInput,
): AIAdapterCapabilities {
  return {
    kind: "text-generation",
    binding: CLAUDE_TEXT_GENERATION_BINDING,
    modelName: input.modelName,
    modelVersion: input.modelVersion,
    modelProviderRegion: input.region,
    supportedResponseContracts: ["free-text"],
    maxContextTokens: 200_000,
    maxOutputTokens: 8_192,
    supportsStreaming: true,
    supportsToolUse: false,
    supportsStructuredOutput: false,
    supportsDeterminismHint: false,
    requiresNetwork: true,
    egressesInputsToThirdParty: true,
    dataResidencyGuarantee: input.region,
    costPerInputToken: 3e-6,
    costPerOutputToken: 15e-6,
    rateLimitTokensPerMinute: 400_000,
    conformanceTier: "B",
    adapterVersion: CLAUDE_ADAPTER_VERSION,
    minPlatformKernelVersion: CLAUDE_MIN_PLATFORM_KERNEL_VERSION,
  };
}

export function buildStructuredOutputCapabilities(
  input: BaseCapInput,
): AIAdapterCapabilities {
  return {
    kind: "structured-output",
    binding: CLAUDE_STRUCTURED_OUTPUT_BINDING,
    modelName: input.modelName,
    modelVersion: input.modelVersion,
    modelProviderRegion: input.region,
    supportedResponseContracts: ["json-schema"],
    maxContextTokens: 200_000,
    maxOutputTokens: 8_192,
    supportsStreaming: false,
    supportsToolUse: false,
    supportsStructuredOutput: true,
    supportsDeterminismHint: false,
    requiresNetwork: true,
    egressesInputsToThirdParty: true,
    dataResidencyGuarantee: input.region,
    costPerInputToken: 3e-6,
    costPerOutputToken: 15e-6,
    rateLimitTokensPerMinute: 400_000,
    conformanceTier: "B",
    adapterVersion: CLAUDE_ADAPTER_VERSION,
    minPlatformKernelVersion: CLAUDE_MIN_PLATFORM_KERNEL_VERSION,
  };
}
