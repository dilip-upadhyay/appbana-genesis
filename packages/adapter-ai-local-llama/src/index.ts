/**
 * Public API for `@appbana/adapter-ai-local-llama`.
 */

export const LOCAL_LLAMA_ADAPTER_PACKAGE_VERSION = "0.1.0";

export {
  createLocalLlamaTextGenerationAdapter,
  type CreateTextGenerationInput,
} from "./text-generation.js";

export {
  createLocalLlamaStructuredOutputAdapter,
  type CreateStructuredOutputInput,
} from "./structured-output.js";

export {
  LLAMA_ADAPTER_VERSION,
  LLAMA_MIN_PLATFORM_KERNEL_VERSION,
  LLAMA_TEXT_GENERATION_BINDING,
  LLAMA_STRUCTURED_OUTPUT_BINDING,
  DEFAULT_LLAMA_MODEL_NAME,
  DEFAULT_LLAMA_MODEL_VERSION,
  DEFAULT_LLAMA_REGION,
  DEFAULT_LLAMA_BASE_URL,
  buildTextGenerationCapabilities,
  buildStructuredOutputCapabilities,
} from "./capabilities.js";

export type {
  LocalLlamaAdapterConfig,
  LocalLlamaClient,
  LocalLlamaClientFactory,
  LocalLlamaChatMessage,
  LocalLlamaChatRequest,
  LocalLlamaChatResponse,
  LocalLlamaChatChoice,
  LocalLlamaChatUsage,
  LocalLlamaChatStream,
  LocalLlamaChatStreamChunk,
  LocalLlamaRequestOptions,
} from "./client.js";
