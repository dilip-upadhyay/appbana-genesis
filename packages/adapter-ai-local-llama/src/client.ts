/**
 * OpenAI-compatible chat-completions client interface. The consumer wires
 * this against llama.cpp / vLLM / Ollama / LM Studio — the adapter itself
 * never speaks HTTP.
 */

export interface LocalLlamaAdapterConfig {
  readonly modelName: string;
  readonly modelVersion: string;
  readonly region: string;
  /**
   * Base URL of the OpenAI-compatible endpoint. Informational only — the
   * default factory does NOT dial it; consumers supply their own
   * `clientFactory` and are free to ignore this hint.
   */
  readonly baseUrl?: string;
  readonly clientFactory?: LocalLlamaClientFactory;
}

export type LocalLlamaClientFactory = (
  config: LocalLlamaAdapterConfig,
) => Promise<LocalLlamaClient>;

export interface LocalLlamaClient {
  readonly chatCompletions: {
    create(
      request: LocalLlamaChatRequest,
      opts?: LocalLlamaRequestOptions,
    ): Promise<LocalLlamaChatResponse>;
    stream(
      request: LocalLlamaChatRequest,
      opts?: LocalLlamaRequestOptions,
    ): LocalLlamaChatStream;
  };
}

export interface LocalLlamaRequestOptions {
  readonly signal?: AbortSignal;
}

export interface LocalLlamaChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LocalLlamaChatRequest {
  readonly model: string;
  readonly messages: readonly LocalLlamaChatMessage[];
  readonly max_tokens: number;
  readonly temperature?: number;
  readonly seed?: number;
  readonly response_format?: { readonly type: "json_object" };
}

export interface LocalLlamaChatChoice {
  readonly index: number;
  readonly message: { readonly role: "assistant"; readonly content: string };
  readonly finish_reason: string;
}

export interface LocalLlamaChatUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
}

export interface LocalLlamaChatResponse {
  readonly id: string;
  readonly model: string;
  readonly choices: readonly LocalLlamaChatChoice[];
  readonly usage: LocalLlamaChatUsage;
}

/**
 * Streaming events follow OpenAI's `chat.completion.chunk` shape. Only the
 * delta content matters here; role deltas and function-call deltas are
 * ignored at v0.1.
 */
export interface LocalLlamaChatStreamChunk {
  readonly id: string;
  readonly choices: readonly {
    readonly index: number;
    readonly delta: { readonly content?: string };
    readonly finish_reason?: string | null;
  }[];
}

export interface LocalLlamaChatStream
  extends AsyncIterable<LocalLlamaChatStreamChunk> {
  /**
   * Resolves after the stream drains and returns the full assembled response
   * (including token usage). MUST be called by the adapter to obtain usage
   * counts for provenance.
   */
  finalMessage(): Promise<LocalLlamaChatResponse>;
}

/**
 * Default factory — deliberately errors. Consumers MUST supply their own
 * factory that wraps their preferred local runtime.
 */
export const defaultClientFactory: LocalLlamaClientFactory = async () => {
  throw new Error(
    "@appbana/adapter-ai-local-llama does not bundle an HTTP client. " +
      "Wire your llama.cpp/vLLM/Ollama endpoint via " +
      "createLocalLlamaTextGenerationAdapter({ clientFactory: async (cfg) => yourClient }). " +
      "See the package README for a fetch-based example.",
  );
};
