/**
 * Text-generation adapter — `ai:local-llama`. Chat completions against a
 * locally hosted Llama 3.3 70B; supports streaming SSE deltas.
 */

import type {
  AIAdapterCapabilities,
  AIAdapterConfig,
  AIAdapterHealth,
  AIAdapterInitContext,
  AIInvocationChunk,
  AIInvocationContext,
  AIInvocationRequest,
  AIInvocationResult,
  AIModelAdapter,
} from "@appbana/adapter-ai-contract";
import type { RedactionRule } from "@appbana/security-redaction";
import { redact } from "@appbana/security-redaction";

import type {
  LocalLlamaAdapterConfig,
  LocalLlamaClient,
  LocalLlamaClientFactory,
} from "./client.js";
import { defaultClientFactory } from "./client.js";
import {
  DEFAULT_LLAMA_BASE_URL,
  DEFAULT_LLAMA_MODEL_NAME,
  DEFAULT_LLAMA_MODEL_VERSION,
  DEFAULT_LLAMA_REGION,
  LLAMA_TEXT_GENERATION_BINDING,
  buildTextGenerationCapabilities,
} from "./capabilities.js";
import {
  buildProvenance,
  coalesceRedactionRules,
  llamaInvoke,
} from "./invoke.js";
import type { LlamaInvokeDeps } from "./invoke.js";
import { canonicalJson, sha256Hex } from "./hashing.js";

export interface CreateTextGenerationInput {
  readonly modelName?: string;
  readonly modelVersion?: string;
  readonly region?: string;
  readonly baseUrl?: string;
  readonly redactionRules?: readonly RedactionRule[];
  readonly clientFactory?: LocalLlamaClientFactory;
}

export function createLocalLlamaTextGenerationAdapter(
  input: CreateTextGenerationInput = {},
): AIModelAdapter<"text-generation"> {
  const region = input.region ?? DEFAULT_LLAMA_REGION;
  const capabilities: AIAdapterCapabilities = buildTextGenerationCapabilities({
    modelName: input.modelName ?? DEFAULT_LLAMA_MODEL_NAME,
    modelVersion: input.modelVersion ?? DEFAULT_LLAMA_MODEL_VERSION,
    region,
  });
  const redactionRules = coalesceRedactionRules(input.redactionRules);
  const clientFactory = input.clientFactory ?? defaultClientFactory;
  const baseUrl = input.baseUrl ?? DEFAULT_LLAMA_BASE_URL;

  let client: LocalLlamaClient | undefined;

  const adapter: AIModelAdapter<"text-generation"> = {
    kind: "text-generation",
    binding: LLAMA_TEXT_GENERATION_BINDING,
    capabilities,

    async init(_config: AIAdapterConfig, _ctx: AIAdapterInitContext) {
      const merged: LocalLlamaAdapterConfig = {
        modelName: capabilities.modelName,
        modelVersion: capabilities.modelVersion,
        region,
        baseUrl,
        ...(input.clientFactory !== undefined
          ? { clientFactory: input.clientFactory }
          : {}),
      };
      client = await clientFactory(merged);
    },

    async invoke(
      request: AIInvocationRequest,
      ctx: AIInvocationContext,
    ): Promise<AIInvocationResult> {
      if (client === undefined) {
        throw new Error("adapter.init() must be called before invoke()");
      }
      const deps: LlamaInvokeDeps = {
        client,
        capabilities,
        redactionRules,
        buildMessages: (req, redacted) => ({
          systemPrompt: buildSystemPrompt(req),
          userPrompt: canonicalJson(redacted),
        }),
        parseResponse: (_req, response) => {
          const text = response.choices.map((c) => c.message.content).join("");
          return { outcome: "accepted", artifact: text, diagnostics: [] };
        },
      };
      return llamaInvoke({ deps, request, ctx });
    },

    invokeStream(
      request: AIInvocationRequest,
      ctx: AIInvocationContext,
    ): AsyncIterable<AIInvocationChunk> {
      if (client === undefined) {
        throw new Error("adapter.init() must be called before invokeStream()");
      }
      return streamText({
        client,
        capabilities,
        redactionRules,
        request,
        ctx,
      });
    },

    async shutdown() {
      client = undefined;
    },

    async health(): Promise<AIAdapterHealth> {
      return {
        state: client !== undefined ? "healthy" : "unhealthy",
        summary:
          client !== undefined
            ? "local llama client ready"
            : "adapter not initialised",
        // eslint-disable-next-line no-restricted-syntax -- health() is an I/O liveness probe. `checkedAt` records when the probe actually ran; it is observability of an external system, not a value on the deterministic execution path.
        checkedAt: new Date().toISOString(),
      };
    },
  };

  return adapter;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

interface StreamInput {
  readonly client: LocalLlamaClient;
  readonly capabilities: AIAdapterCapabilities;
  readonly redactionRules: readonly RedactionRule[];
  readonly request: AIInvocationRequest;
  readonly ctx: AIInvocationContext;
}

async function* streamText(
  input: StreamInput,
): AsyncIterable<AIInvocationChunk> {
  const { client, capabilities, redactionRules, request, ctx } = input;
  const requestedAt = ctx.now();

  if (!capabilities.supportedResponseContracts.includes(request.responseContract.kind)) {
    const redaction = { redactedInputs: request.inputs, redactions: [] };
    yield {
      correlationId: request.correlationId,
      terminal: true,
      outcome: "failed",
      diagnostics: [
        {
          code: "CONTRACT_UNSUPPORTED",
          message: `adapter binding ${capabilities.binding} does not support response contract kind "${request.responseContract.kind}"`,
          severity: "error",
        },
      ],
      provenance: buildProvenance({
        deps: {
          client,
          capabilities,
          redactionRules,
          buildMessages: () => ({ systemPrompt: "", userPrompt: "" }),
          parseResponse: () => ({ outcome: "failed", diagnostics: [] }),
        },
        request,
        tenantId: ctx.tenantId,
        redaction,
        tokenUsage: { input: 0, output: 0, total: 0 },
        outputText: "<contract-unsupported>",
        requestedAt,
        completedAt: requestedAt,
      }),
    };
    return;
  }

  const redaction = redact(request.inputs, redactionRules);
  const systemPrompt = buildSystemPrompt(request);
  const userPrompt = canonicalJson(redaction.redactedInputs);

  const stream = client.chatCompletions.stream(
    {
      model: capabilities.modelName,
      max_tokens: Math.min(
        request.budget.maxOutputTokens ?? capabilities.maxOutputTokens,
        capabilities.maxOutputTokens,
      ),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    },
    ctx.signal !== undefined ? { signal: ctx.signal } : undefined,
  );

  let assembled = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta.content;
    if (typeof delta === "string" && delta.length > 0) {
      assembled += delta;
      yield {
        correlationId: request.correlationId,
        terminal: false,
        delta,
      };
    }
  }

  const final = await stream.finalMessage();
  const completedAt = ctx.now();
  const provenance = buildProvenance({
    deps: {
      client,
      capabilities,
      redactionRules,
      buildMessages: () => ({ systemPrompt, userPrompt }),
      parseResponse: () => ({ outcome: "accepted", diagnostics: [] }),
    },
    request,
    tenantId: ctx.tenantId,
    redaction,
    tokenUsage: {
      input: final.usage.prompt_tokens,
      output: final.usage.completion_tokens,
      total: final.usage.total_tokens,
    },
    outputText: assembled || sha256Hex("<empty-stream>"),
    requestedAt,
    completedAt,
  });

  yield {
    correlationId: request.correlationId,
    terminal: true,
    outcome: "accepted",
    provenance,
  };
}

function buildSystemPrompt(request: AIInvocationRequest): string {
  return [
    "You are an AppBana Genesis assistant running on a locally hosted Llama model.",
    `Prompt template: ${request.promptTemplateRef}@${request.promptTemplateVersion}.`,
    "Respond in plain text unless otherwise instructed by the user message.",
  ].join(" ");
}
