/**
 * Minimal Anthropic Messages API subset the adapter depends on. Real code
 * wires this to `@anthropic-ai/sdk`; tests inject a fake.
 *
 * Kept intentionally narrow: only the fields the adapter reads or emits.
 */

export interface AnthropicMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AnthropicMessagesRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly messages: readonly AnthropicMessage[];
  readonly system?: string;
  readonly temperature?: number;
  /** Anthropic honours a seed for beta deterministic mode; SDK v0.30+ passes through. */
  readonly seed?: number;
}

export interface AnthropicTextContentBlock {
  readonly type: "text";
  readonly text: string;
}

export interface AnthropicUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export type AnthropicStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use";

export interface AnthropicMessagesResponse {
  readonly id: string;
  readonly model: string;
  readonly content: readonly AnthropicTextContentBlock[];
  readonly usage: AnthropicUsage;
  readonly stop_reason: AnthropicStopReason;
}

export interface AnthropicContentBlockDelta {
  readonly type: "content_block_delta";
  readonly delta: { readonly type: "text_delta"; readonly text: string };
}

export interface AnthropicMessageStopEvent {
  readonly type: "message_stop";
}

export type AnthropicStreamEvent =
  | AnthropicContentBlockDelta
  | AnthropicMessageStopEvent;

export interface AnthropicMessageStream
  extends AsyncIterable<AnthropicStreamEvent> {
  finalMessage(): Promise<AnthropicMessagesResponse>;
}

export interface AnthropicRequestOptions {
  readonly signal?: AbortSignal;
}

export interface AnthropicClient {
  readonly messages: {
    create(
      req: AnthropicMessagesRequest,
      opts?: AnthropicRequestOptions,
    ): Promise<AnthropicMessagesResponse>;
    stream(
      req: AnthropicMessagesRequest,
      opts?: AnthropicRequestOptions,
    ): AnthropicMessageStream;
  };
}

/** Constructed once during `init()` and reused across invocations. */
export type AnthropicClientFactory = (
  config: ClaudeAdapterConfig,
) => Promise<AnthropicClient>;

// Re-exported here to break the circular import between config.ts and this file.
export interface ClaudeAdapterConfig {
  readonly apiKey: string;
  readonly modelName: string;
  readonly modelVersion: string;
  readonly region?: string;
  readonly clientFactory?: AnthropicClientFactory;
}

/**
 * Default factory — throws with an actionable error. Callers MUST supply a
 * `clientFactory` in `ClaudeAdapterConfig`. See README for the recommended
 * wiring against `@anthropic-ai/sdk`.
 */
export const defaultClientFactory: AnthropicClientFactory = () => {
  return Promise.reject(
    new Error(
      "@appbana/adapter-ai-anthropic-claude v0.1 requires an explicit clientFactory. " +
        "Wire @anthropic-ai/sdk in your kernel and pass a factory via ClaudeAdapterConfig.clientFactory. " +
        "See the package README for the recommended snippet.",
    ),
  );
};
