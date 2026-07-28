/**
 * Structured-output adapter — `ai:local-llama-json`. Uses OpenAI-compatible
 * `response_format: { type: "json_object" }` plus schema-in-system-prompt +
 * post-hoc shape check.
 */

import type {
  AIAdapterConfig,
  AIAdapterHealth,
  AIAdapterInitContext,
  AIInvocationContext,
  AIInvocationRequest,
  AIInvocationResult,
  AIModelAdapter,
  AIResponseContract,
  Diagnostic,
} from "@appbana/adapter-ai-contract";
import type { RedactionRule } from "@appbana/security-redaction";

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
  LLAMA_STRUCTURED_OUTPUT_BINDING,
  buildStructuredOutputCapabilities,
} from "./capabilities.js";
import { coalesceRedactionRules, llamaInvoke } from "./invoke.js";
import type { LlamaInvokeDeps } from "./invoke.js";
import { canonicalJson } from "./hashing.js";

export interface CreateStructuredOutputInput {
  readonly modelName?: string;
  readonly modelVersion?: string;
  readonly region?: string;
  readonly baseUrl?: string;
  readonly redactionRules?: readonly RedactionRule[];
  readonly clientFactory?: LocalLlamaClientFactory;
}

export function createLocalLlamaStructuredOutputAdapter(
  input: CreateStructuredOutputInput = {},
): AIModelAdapter<"structured-output"> {
  const region = input.region ?? DEFAULT_LLAMA_REGION;
  const capabilities = buildStructuredOutputCapabilities({
    modelName: input.modelName ?? DEFAULT_LLAMA_MODEL_NAME,
    modelVersion: input.modelVersion ?? DEFAULT_LLAMA_MODEL_VERSION,
    region,
  });
  const redactionRules = coalesceRedactionRules(input.redactionRules);
  const clientFactory = input.clientFactory ?? defaultClientFactory;
  const baseUrl = input.baseUrl ?? DEFAULT_LLAMA_BASE_URL;

  let client: LocalLlamaClient | undefined;

  const adapter: AIModelAdapter<"structured-output"> = {
    kind: "structured-output",
    binding: LLAMA_STRUCTURED_OUTPUT_BINDING,
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
          systemPrompt: buildStructuredSystemPrompt(req.responseContract),
          userPrompt: canonicalJson(redacted),
          responseFormat: { type: "json_object" },
        }),
        parseResponse: (req, response) =>
          parseStructuredResponse(req.responseContract, response),
      };
      return llamaInvoke({ deps, request, ctx });
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
// Structured-output parsing
// ---------------------------------------------------------------------------

interface StructuredParseResult {
  readonly outcome: "accepted" | "schema-invalid";
  readonly artifact?: unknown;
  readonly diagnostics: readonly Diagnostic[];
}

function parseStructuredResponse(
  contract: AIResponseContract,
  response: { readonly choices: readonly { readonly message: { readonly content: string } }[] },
): StructuredParseResult {
  const text = response.choices.map((c) => c.message.content).join("");
  if (text.length === 0) {
    return {
      outcome: "schema-invalid",
      diagnostics: [
        { code: "EMPTY_RESPONSE", message: "model returned no content", severity: "error" },
      ],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      outcome: "schema-invalid",
      diagnostics: [
        {
          code: "INVALID_JSON",
          message: `model output is not valid JSON: ${err instanceof Error ? err.message : "parse error"}`,
          severity: "error",
        },
      ],
    };
  }
  if (contract.kind === "json-schema") {
    const shapeError = shapeCheck(parsed, contract.schema);
    if (shapeError !== undefined) {
      return {
        outcome: "schema-invalid",
        diagnostics: [
          { code: "SCHEMA_SHAPE_MISMATCH", message: shapeError, severity: "error" },
        ],
      };
    }
  }
  return { outcome: "accepted", artifact: parsed, diagnostics: [] };
}

/**
 * Lightweight schema shape check — v0.1 only validates top-level `type` and
 * `required`. A full JSON Schema validator (Ajv) is a follow-up.
 */
function shapeCheck(
  value: unknown,
  schema: Readonly<Record<string, unknown>>,
): string | undefined {
  const type = schema["type"];
  if (typeof type !== "string") return undefined;
  const typeMismatch = checkType(value, type);
  if (typeMismatch !== undefined) return typeMismatch;
  if (type === "object") {
    return checkRequired(value as Record<string, unknown>, schema["required"]);
  }
  return undefined;
}

function checkType(value: unknown, type: string): string | undefined {
  switch (type) {
    case "object":
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return `expected object, got ${describe(value)}`;
      }
      return undefined;
    case "array":
      return Array.isArray(value)
        ? undefined
        : `expected array, got ${describe(value)}`;
    case "string":
      return typeof value === "string"
        ? undefined
        : `expected string, got ${describe(value)}`;
    case "number":
      return typeof value === "number"
        ? undefined
        : `expected number, got ${describe(value)}`;
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : `expected boolean, got ${describe(value)}`;
    default:
      return undefined;
  }
}

function checkRequired(
  value: Record<string, unknown>,
  required: unknown,
): string | undefined {
  if (!Array.isArray(required)) return undefined;
  const missing = required.filter(
    (k) => typeof k === "string" && !(k in value),
  );
  return missing.length > 0
    ? `missing required properties: ${missing.join(", ")}`
    : undefined;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function buildStructuredSystemPrompt(contract: AIResponseContract): string {
  const base =
    "You are an AppBana Genesis assistant running on a locally hosted Llama model. Reply with a SINGLE JSON document and nothing else.";
  if (contract.kind !== "json-schema") return base;
  return `${base} The JSON MUST conform to this JSON Schema: ${JSON.stringify(contract.schema)}`;
}
