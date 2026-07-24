/**
 * Text-generation adapter — `ai:anthropic-claude`. Implements the `text-generation`
 * capability against Claude's Messages API using a free-text response contract.
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

import type {
  AnthropicClient,
  AnthropicClientFactory,
  ClaudeAdapterConfig,
} from "./client.js";
import { defaultClientFactory } from "./client.js";
import {
  CLAUDE_TEXT_GENERATION_BINDING,
  DEFAULT_CLAUDE_MODEL_NAME,
  DEFAULT_CLAUDE_MODEL_VERSION,
  buildTextGenerationCapabilities,
} from "./capabilities.js";
import { buildProvenance, claudeInvoke, coalesceRedactionRules } from "./invoke.js";
import type { ClaudeInvokeDeps } from "./invoke.js";
import { redact } from "@appbana/security-redaction";
import { canonicalJson, sha256Hex } from "./hashing.js";

const DEFAULT_REGION = "us-east-1";

export interface CreateTextGenerationInput {
  readonly apiKey?: string;
  readonly modelName?: string;
  readonly modelVersion?: string;
  readonly region?: string;
  readonly redactionRules?: readonly RedactionRule[];
  readonly clientFactory?: AnthropicClientFactory;
}

export function createClaudeTextGenerationAdapter(
  input: CreateTextGenerationInput = {},
): AIModelAdapter<"text-generation"> {
  const region = input.region ?? DEFAULT_REGION;
  const capabilities: AIAdapterCapabilities = buildTextGenerationCapabilities({
    modelName: input.modelName ?? DEFAULT_CLAUDE_MODEL_NAME,
    modelVersion: input.modelVersion ?? DEFAULT_CLAUDE_MODEL_VERSION,
    region,
  });
  const redactionRules = coalesceRedactionRules(input.redactionRules);
  const clientFactory = input.clientFactory ?? defaultClientFactory;

  let client: AnthropicClient | undefined;

  const adapter: AIModelAdapter<"text-generation"> = {
    kind: "text-generation",
    binding: CLAUDE_TEXT_GENERATION_BINDING,
    capabilities,

    async init(config: AIAdapterConfig, _ctx: AIAdapterInitContext) {
      const apiKey =
        input.apiKey ?? (config["apiKey"] as string | undefined) ?? "";
      const merged: ClaudeAdapterConfig = {
        apiKey,
        modelName: capabilities.modelName,
        modelVersion: capabilities.modelVersion,
        region,
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
      const deps: ClaudeInvokeDeps = {
        client,
        capabilities,
        redactionRules,
        buildPrompt: (req, redacted) => ({
          systemPrompt: buildSystemPrompt(req),
          userPrompt: canonicalJson(redacted),
        }),
        parseResponse: (_req, response) => {
          const text = response.content.map((c) => c.text).join("");
          return {
            outcome: "accepted",
            artifact: text,
            diagnostics: [],
          };
        },
      };
      return claudeInvoke({ deps, request, ctx });
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
            ? "anthropic client ready"
            : "adapter not initialised",
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
  readonly client: AnthropicClient;
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
          buildPrompt: () => ({ systemPrompt: "", userPrompt: "" }),
          parseResponse: () => ({ outcome: "failed", diagnostics: [] }),
        },
        request,
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

  const stream = client.messages.stream(
    {
      model: capabilities.modelName,
      max_tokens: Math.min(
        request.budget.maxOutputTokens ?? capabilities.maxOutputTokens,
        capabilities.maxOutputTokens,
      ),
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    },
    ctx.signal !== undefined ? { signal: ctx.signal } : undefined,
  );

  let assembled = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta") {
      const text = event.delta.text;
      assembled += text;
      yield {
        correlationId: request.correlationId,
        terminal: false,
        delta: text,
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
      buildPrompt: () => ({ systemPrompt, userPrompt }),
      parseResponse: () => ({
        outcome: "accepted",
        diagnostics: [],
      }),
    },
    request,
    redaction,
    tokenUsage: {
      input: final.usage.input_tokens,
      output: final.usage.output_tokens,
      total: final.usage.input_tokens + final.usage.output_tokens,
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
    "You are an AppBana Genesis assistant.",
    `Prompt template: ${request.promptTemplateRef}@${request.promptTemplateVersion}.`,
    "Respond in plain text unless otherwise instructed by the user message.",
  ].join(" ");
}
