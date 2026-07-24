/**
 * Deterministic fake `AnthropicClient` used by every test in this package.
 *
 * The fake supports both `messages.create` and `messages.stream`. Behaviour is
 * driven by a small `FakeBehavior` script so individual tests can compose
 * happy-path, error, and structured-output scenarios without mocking libraries.
 */

import type {
  AnthropicClient,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicMessageStream,
  AnthropicRequestOptions,
  AnthropicStreamEvent,
} from "../dist/index.js";

export interface FakeBehavior {
  /**
   * Text the fake returns as `content[0].text`. For structured-output tests
   * pass a stringified JSON document.
   */
  readonly responseText?: string;
  /** Override the reported usage counts. */
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number };
  /** When set, `messages.create` rejects with this error. */
  readonly throwOnCreate?: Error;
  /** Stream chunks the fake yields, in order. Terminal message uses `responseText`. */
  readonly streamChunks?: readonly string[];
}

export interface FakeCallRecord {
  readonly method: "create" | "stream";
  readonly request: AnthropicMessagesRequest;
  readonly signalPresent: boolean;
}

export interface FakeAnthropicClient extends AnthropicClient {
  readonly calls: readonly FakeCallRecord[];
}

export function createFakeAnthropicClient(
  behavior: FakeBehavior = {},
): FakeAnthropicClient {
  const calls: FakeCallRecord[] = [];
  const responseText = behavior.responseText ?? "ok";
  const usage = behavior.usage ?? { input_tokens: 3, output_tokens: 5 };

  const client: AnthropicClient = {
    messages: {
      create: async (
        request: AnthropicMessagesRequest,
        opts?: AnthropicRequestOptions,
      ): Promise<AnthropicMessagesResponse> => {
        calls.push({
          method: "create",
          request,
          signalPresent: opts?.signal !== undefined,
        });
        if (behavior.throwOnCreate !== undefined) {
          throw behavior.throwOnCreate;
        }
        return {
          id: "msg_fake_1",
          model: request.model,
          content: [{ type: "text", text: responseText }],
          usage,
          stop_reason: "end_turn",
        };
      },
      stream: (
        request: AnthropicMessagesRequest,
        opts?: AnthropicRequestOptions,
      ): AnthropicMessageStream => {
        calls.push({
          method: "stream",
          request,
          signalPresent: opts?.signal !== undefined,
        });
        const chunks =
          behavior.streamChunks ??
          splitInto(responseText, 3);
        return makeFakeStream({
          chunks,
          finalMessage: {
            id: "msg_fake_stream_1",
            model: request.model,
            content: [{ type: "text", text: chunks.join("") }],
            usage,
            stop_reason: "end_turn",
          },
        });
      },
    },
  };

  return Object.assign(client, { calls }) as FakeAnthropicClient;
}

interface StreamInput {
  readonly chunks: readonly string[];
  readonly finalMessage: AnthropicMessagesResponse;
}

function makeFakeStream(input: StreamInput): AnthropicMessageStream {
  async function* events(): AsyncIterableIterator<AnthropicStreamEvent> {
    for (const chunk of input.chunks) {
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: chunk },
      };
    }
    yield { type: "message_stop" };
  }
  const iterable: AsyncIterable<AnthropicStreamEvent> = {
    [Symbol.asyncIterator]: () => events(),
  };
  return Object.assign(iterable, {
    finalMessage: async () => input.finalMessage,
  });
}

function splitInto(text: string, parts: number): readonly string[] {
  if (text.length === 0) return [""];
  const size = Math.max(1, Math.ceil(text.length / parts));
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}
