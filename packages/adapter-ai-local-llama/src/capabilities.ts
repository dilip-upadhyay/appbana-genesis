/**
 * Capability declarations for the local Llama reference adapter. Values MUST
 * stay consistent with `examples/customer-onboarding/ai-adapter-manifests/local-llama.manifest.json`.
 */

import type { AIAdapterCapabilities } from "@appbana/adapter-ai-contract";

export const LLAMA_ADAPTER_VERSION = "0.1.0";
export const LLAMA_MIN_PLATFORM_KERNEL_VERSION = "0.1.0";

export const DEFAULT_LLAMA_MODEL_NAME = "llama-3.3-70b-instruct";
export const DEFAULT_LLAMA_MODEL_VERSION = "2026-05-release";
export const DEFAULT_LLAMA_REGION = "on-prem";
export const DEFAULT_LLAMA_BASE_URL = "http://localhost:11434/v1";

export const LLAMA_TEXT_GENERATION_BINDING = "ai:local-llama";
export const LLAMA_STRUCTURED_OUTPUT_BINDING = "ai:local-llama-json";

export interface CapabilityInput {
  readonly modelName: string;
  readonly modelVersion: string;
  readonly region: string;
}

export function buildTextGenerationCapabilities(
  input: CapabilityInput,
): AIAdapterCapabilities {
  return {
    kind: "text-generation",
    binding: LLAMA_TEXT_GENERATION_BINDING,
    modelName: input.modelName,
    modelVersion: input.modelVersion,
    modelProviderRegion: input.region,
    supportedResponseContracts: ["free-text"],
    maxContextTokens: 128_000,
    maxOutputTokens: 4096,
    supportsStreaming: true,
    supportsToolUse: false,
    supportsStructuredOutput: false,
    supportsDeterminismHint: true,
    requiresNetwork: false,
    egressesInputsToThirdParty: false,
    dataResidencyGuarantee: input.region,
    conformanceTier: "A",
    adapterVersion: LLAMA_ADAPTER_VERSION,
    minPlatformKernelVersion: LLAMA_MIN_PLATFORM_KERNEL_VERSION,
  };
}

export function buildStructuredOutputCapabilities(
  input: CapabilityInput,
): AIAdapterCapabilities {
  return {
    kind: "structured-output",
    binding: LLAMA_STRUCTURED_OUTPUT_BINDING,
    modelName: input.modelName,
    modelVersion: input.modelVersion,
    modelProviderRegion: input.region,
    supportedResponseContracts: ["json-schema"],
    maxContextTokens: 128_000,
    maxOutputTokens: 4096,
    supportsStreaming: false,
    supportsToolUse: false,
    supportsStructuredOutput: true,
    supportsDeterminismHint: true,
    requiresNetwork: false,
    egressesInputsToThirdParty: false,
    dataResidencyGuarantee: input.region,
    conformanceTier: "A",
    adapterVersion: LLAMA_ADAPTER_VERSION,
    minPlatformKernelVersion: LLAMA_MIN_PLATFORM_KERNEL_VERSION,
  };
}
