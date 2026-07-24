/**
 * Deterministic fake `LocalLlamaClient` for tests. Behaviour is scripted via
 * `FakeBehavior`. When `seedRoutedResponses` is set, the fake returns the
 * canned text keyed by `request.seed` — this lets the Tier A determinism
 * check verify that identical seeds produce identical outputHash.
 */

import type {
  LocalLlamaChatRequest,
  LocalLlamaChatResponse,
  LocalLlamaChatStream,
  LocalLlamaChatStreamChunk,
  LocalLlamaClient,
  LocalLlamaRequestOptions,
} from "../dist/index.js";

export interface FakeBehavior {
  readonly responseText?: string;
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
  readonly throwOnCreate?: Error;
  readonly streamChunks?: readonly string[];
  /** If set, `messages.create` returns the string keyed by `request.seed`. */
  readonly seedRoutedResponses?: ReadonlyMap<number, string>;
}

export interface FakeCallRecord {
  readonly method: "create" | "stream";
  readonly request: LocalLlamaChatRequest;
  readonly signalPresent: boolean;
}

export interface FakeLocalLlamaClient extends LocalLlamaClient {
  readonly calls: readonly FakeCallRecord[];
}

export function createFakeLocalLlamaClient(
  behavior: FakeBehavior = {},
): FakeLocalLlamaClient {
  const calls: FakeCallRecord[] = [];
  const defaultText = behavior.responseText ?? "ok";
  const defaultUsage =
    behavior.usage ?? { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 };

  const client: LocalLlamaClient = {
    chatCompletions: {
      create: async (
        request: LocalLlamaChatRequest,
        opts?: LocalLlamaRequestOptions,
      ): Promise<LocalLlamaChatResponse> => {
        calls.push({
          method: "create",
          request,
          signalPresent: opts?.signal !== undefined,
        });
        if (behavior.throwOnCreate !== undefined) {
          throw behavior.throwOnCreate;
        }
        const text =
          behavior.seedRoutedResponses !== undefined && request.seed !== undefined
            ? behavior.seedRoutedResponses.get(request.seed) ?? defaultText
            : defaultText;
        return {
          id: "chatcmpl_fake_1",
          model: request.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: text },
              finish_reason: "stop",
            },
          ],
          usage: defaultUsage,
        };
      },
      stream: (
        request: LocalLlamaChatRequest,
        opts?: LocalLlamaRequestOptions,
      ): LocalLlamaChatStream => {
        calls.push({
          method: "stream",
          request,
          signalPresent: opts?.signal !== undefined,
        });
        const chunks = behavior.streamChunks ?? splitInto(defaultText, 3);
        return makeFakeStream({
          chunks,
          finalMessage: {
            id: "chatcmpl_fake_stream_1",
            model: request.model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: chunks.join("") },
                finish_reason: "stop",
              },
            ],
            usage: defaultUsage,
          },
        });
      },
    },
  };
  return Object.assign(client, { calls }) as FakeLocalLlamaClient;
}

interface StreamInput {
  readonly chunks: readonly string[];
  readonly finalMessage: LocalLlamaChatResponse;
}

function makeFakeStream(input: StreamInput): LocalLlamaChatStream {
  async function* events(): AsyncIterableIterator<LocalLlamaChatStreamChunk> {
    for (const chunk of input.chunks) {
      yield {
        id: "chatcmpl_fake_stream_1",
        choices: [
          { index: 0, delta: { content: chunk }, finish_reason: null },
        ],
      };
    }
    yield {
      id: "chatcmpl_fake_stream_1",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };
  }
  const iterable: AsyncIterable<LocalLlamaChatStreamChunk> = {
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
