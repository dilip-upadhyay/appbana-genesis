/**
 * @appbana/adapter-ai-anthropic-claude
 *
 * Barrel export. Downstream packages MUST import from this entry point only.
 *
 * @see docs/adr/ADR-015-ai-model-adapter-layer.md
 * @see docs/schemas/ai-adapter-manifest.v0.1.schema.json
 */

export const CLAUDE_ADAPTER_PACKAGE_VERSION = "0.1.0" as const;

export {
  createClaudeTextGenerationAdapter,
} from "./text-generation.js";
export type { CreateTextGenerationInput } from "./text-generation.js";

export {
  createClaudeStructuredOutputAdapter,
} from "./structured-output.js";
export type { CreateStructuredOutputInput } from "./structured-output.js";

export {
  CLAUDE_ADAPTER_VERSION,
  CLAUDE_MIN_PLATFORM_KERNEL_VERSION,
  CLAUDE_STRUCTURED_OUTPUT_BINDING,
  CLAUDE_TEXT_GENERATION_BINDING,
  DEFAULT_CLAUDE_MODEL_NAME,
  DEFAULT_CLAUDE_MODEL_VERSION,
} from "./capabilities.js";

export type {
  AnthropicClient,
  AnthropicClientFactory,
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicMessageStream,
  AnthropicRequestOptions,
  AnthropicStopReason,
  AnthropicStreamEvent,
  AnthropicTextContentBlock,
  AnthropicUsage,
  ClaudeAdapterConfig,
} from "./client.js";
