/**
 * Structured-output adapter — `ai:anthropic-claude-json`. Implements the
 * `structured-output` capability using the JSON-schema response contract.
 *
 * v0.1 approach: the JSON Schema is serialised into the system prompt, the
 * model is instructed to emit JSON only, and the response is parsed +
 * shape-validated by the adapter before being returned. On any failure the
 * adapter returns `outcome: "schema-invalid"` with a diagnostic — never throws.
 * Tool-use enforcement is a v0.2 follow-up.
 */

import type {
  AIAdapterCapabilities,
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
  AnthropicClient,
  AnthropicClientFactory,
  AnthropicMessagesResponse,
  ClaudeAdapterConfig,
} from "./client.js";
import { defaultClientFactory } from "./client.js";
import {
  CLAUDE_STRUCTURED_OUTPUT_BINDING,
  DEFAULT_CLAUDE_MODEL_NAME,
  DEFAULT_CLAUDE_MODEL_VERSION,
  buildStructuredOutputCapabilities,
} from "./capabilities.js";
import { claudeInvoke, coalesceRedactionRules } from "./invoke.js";
import type { ClaudeInvokeDeps } from "./invoke.js";
import { canonicalJson } from "./hashing.js";

const DEFAULT_REGION = "us-east-1";

export interface CreateStructuredOutputInput {
  readonly apiKey?: string;
  readonly modelName?: string;
  readonly modelVersion?: string;
  readonly region?: string;
  readonly redactionRules?: readonly RedactionRule[];
  readonly clientFactory?: AnthropicClientFactory;
}

export function createClaudeStructuredOutputAdapter(
  input: CreateStructuredOutputInput = {},
): AIModelAdapter<"structured-output"> {
  const region = input.region ?? DEFAULT_REGION;
  const capabilities: AIAdapterCapabilities = buildStructuredOutputCapabilities({
    modelName: input.modelName ?? DEFAULT_CLAUDE_MODEL_NAME,
    modelVersion: input.modelVersion ?? DEFAULT_CLAUDE_MODEL_VERSION,
    region,
  });
  const redactionRules = coalesceRedactionRules(input.redactionRules);
  const clientFactory = input.clientFactory ?? defaultClientFactory;

  let client: AnthropicClient | undefined;

  const adapter: AIModelAdapter<"structured-output"> = {
    kind: "structured-output",
    binding: CLAUDE_STRUCTURED_OUTPUT_BINDING,
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
          systemPrompt: buildStructuredSystemPrompt(req.responseContract),
          userPrompt: canonicalJson(redacted),
        }),
        parseResponse: (req, response) =>
          parseStructuredResponse(req.responseContract, response),
      };
      return claudeInvoke({ deps, request, ctx });
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
// Prompt + response shaping
// ---------------------------------------------------------------------------

function buildStructuredSystemPrompt(
  responseContract: AIResponseContract,
): string {
  if (responseContract.kind !== "json-schema") {
    return "Respond with valid JSON matching the schema documented in the user message.";
  }
  return [
    "You are an AppBana Genesis assistant.",
    "Respond ONLY with a single JSON document that validates against the following JSON Schema.",
    "Do not include any prose, code fences, or commentary.",
    "Schema:",
    JSON.stringify(responseContract.schema),
  ].join(" ");
}

function parseStructuredResponse(
  contract: AIResponseContract,
  response: AnthropicMessagesResponse,
): {
  readonly outcome: "accepted" | "schema-invalid";
  readonly artifact?: unknown;
  readonly diagnostics: readonly Diagnostic[];
} {
  const raw = response.content.map((c) => c.text).join("").trim();
  if (raw.length === 0) {
    return {
      outcome: "schema-invalid",
      diagnostics: [
        {
          code: "EMPTY_RESPONSE",
          message: "structured-output adapter received empty content",
          severity: "error",
        },
      ],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      outcome: "schema-invalid",
      diagnostics: [
        {
          code: "INVALID_JSON",
          message: `response is not valid JSON: ${message}`,
          severity: "error",
        },
      ],
    };
  }

  if (contract.kind === "json-schema") {
    const shape = shapeCheck(parsed, contract.schema);
    if (shape !== undefined) {
      return {
        outcome: "schema-invalid",
        diagnostics: [
          {
            code: "SCHEMA_SHAPE_MISMATCH",
            message: shape,
            severity: "error",
          },
        ],
      };
    }
  }

  return { outcome: "accepted", artifact: parsed, diagnostics: [] };
}

/**
 * Lightweight schema shape check — v0.1 only validates top-level `type` and
 * `required`. A full JSON Schema validator (Ajv) is a follow-up. Returning
 * `undefined` means the parsed value shape-matches.
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
