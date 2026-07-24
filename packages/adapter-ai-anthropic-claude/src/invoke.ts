/**
 * Shared invoke logic for both Claude adapters. Handles:
 *   - redaction (pre-network)
 *   - budget pre-check
 *   - AnthropicClient call
 *   - abort surface
 *   - provenance record construction
 *
 * The adapter classes wrap this with kind-specific request/response shaping.
 */

import type {
  AIAdapterCapabilities,
  AIAdapterInvocationOutcome,
  AIInvocationContext,
  AIInvocationRequest,
  AIInvocationResult,
  AIProvenanceRecord,
  Diagnostic,
} from "@appbana/adapter-ai-contract";
import type {
  RedactionResult,
  RedactionRule,
} from "@appbana/security-redaction";
import { defaultRedactionRules, redact } from "@appbana/security-redaction";

import type {
  AnthropicClient,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
} from "./client.js";
import { canonicalJson, estimateTokens, sha256Hex } from "./hashing.js";

export interface ClaudeInvokeDeps {
  readonly client: AnthropicClient;
  readonly capabilities: AIAdapterCapabilities;
  readonly redactionRules: readonly RedactionRule[];
  readonly buildPrompt: (
    request: AIInvocationRequest,
    redactedInputs: Readonly<Record<string, unknown>>,
  ) => { readonly systemPrompt: string; readonly userPrompt: string };
  /**
   * Called after a successful Anthropic response. Returns the artifact + any
   * additional diagnostics. For text-generation this is the raw text; for
   * structured-output this is the parsed + validated JSON.
   */
  readonly parseResponse: (
    request: AIInvocationRequest,
    response: AnthropicMessagesResponse,
  ) => {
    readonly outcome: AIAdapterInvocationOutcome;
    readonly artifact?: unknown;
    readonly diagnostics: readonly Diagnostic[];
  };
}

interface InvokeContextInternal {
  readonly deps: ClaudeInvokeDeps;
  readonly request: AIInvocationRequest;
  readonly ctx: AIInvocationContext;
}

export async function claudeInvoke(
  internal: InvokeContextInternal,
): Promise<AIInvocationResult> {
  const { deps, request, ctx } = internal;
  const requestedAt = ctx.now();

  // 0. Refuse contracts this adapter did not declare support for.
  const unsupported = unsupportedContractResult(deps, request, requestedAt);
  if (unsupported !== undefined) {
    return unsupported;
  }

  // 1. Abort before doing anything expensive.
  if (ctx.signal?.aborted === true) {
    return abortedResult(deps, request, requestedAt);
  }

  // 2. Redact inputs BEFORE any network call.
  const redaction: RedactionResult = redact(request.inputs, deps.redactionRules);

  // 3. Build prompt(s) from the redacted view.
  const { systemPrompt, userPrompt } = deps.buildPrompt(
    request,
    redaction.redactedInputs,
  );

  // 4. Budget pre-check — refuse before wire if worst-case cost breaches budget.
  const budgetOutcome = budgetPreCheck({
    capabilities: deps.capabilities,
    systemPrompt,
    userPrompt,
    request,
  });
  if (budgetOutcome !== undefined) {
    return budgetOutcome(deps, request, redaction, requestedAt);
  }

  // 5. Fire the request.
  const anthropicRequest: AnthropicMessagesRequest = {
    model: deps.capabilities.modelName,
    max_tokens: pickMaxTokens(deps.capabilities, request),
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
  };

  let response: AnthropicMessagesResponse;
  try {
    response = await deps.client.messages.create(
      anthropicRequest,
      ctx.signal !== undefined ? { signal: ctx.signal } : undefined,
    );
  } catch (err) {
    return failedResult(deps, request, redaction, requestedAt, ctx.now(), err);
  }

  // 6. Kind-specific response parsing.
  const parsed = deps.parseResponse(request, response);

  const completedAt = ctx.now();
  const provenance = buildProvenance({
    deps,
    request,
    redaction,
    tokenUsage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      total: response.usage.input_tokens + response.usage.output_tokens,
    },
    outputText:
      response.content.map((c) => c.text).join("") || "<empty>",
    requestedAt,
    completedAt,
  });

  const base: AIInvocationResult = {
    outcome: parsed.outcome,
    diagnostics: parsed.diagnostics,
    provenance,
    traceEvents: [],
    correlationId: request.correlationId,
    ...(parsed.artifact !== undefined ? { artifact: parsed.artifact } : {}),
  };
  return base;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickMaxTokens(
  capabilities: AIAdapterCapabilities,
  request: AIInvocationRequest,
): number {
  const budgetMax = request.budget.maxOutputTokens ?? capabilities.maxOutputTokens;
  return Math.min(budgetMax, capabilities.maxOutputTokens);
}

interface BudgetInput {
  readonly capabilities: AIAdapterCapabilities;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly request: AIInvocationRequest;
}

function budgetPreCheck(
  input: BudgetInput,
):
  | ((
      deps: ClaudeInvokeDeps,
      request: AIInvocationRequest,
      redaction: RedactionResult,
      requestedAt: Date,
    ) => AIInvocationResult)
  | undefined {
  const { capabilities, systemPrompt, userPrompt, request } = input;
  const estInput = estimateTokens(systemPrompt) + estimateTokens(userPrompt);

  const maxInput = request.budget.maxInputTokens;
  if (maxInput !== undefined && estInput > maxInput) {
    return (deps, req, redaction, requestedAt) =>
      budgetExceededResult(
        deps,
        req,
        redaction,
        requestedAt,
        `estimated input tokens (${estInput}) exceed budget.maxInputTokens (${maxInput})`,
      );
  }

  const maxCost = request.budget.maxCostUsd;
  if (
    maxCost !== undefined &&
    capabilities.costPerInputToken !== undefined &&
    capabilities.costPerOutputToken !== undefined
  ) {
    const maxOutput = pickMaxTokens(capabilities, request);
    const worstCase =
      estInput * capabilities.costPerInputToken +
      maxOutput * capabilities.costPerOutputToken;
    if (worstCase > maxCost) {
      return (deps, req, redaction, requestedAt) =>
        budgetExceededResult(
          deps,
          req,
          redaction,
          requestedAt,
          `worst-case cost ${worstCase.toFixed(6)} USD exceeds budget.maxCostUsd (${maxCost})`,
        );
    }
  }

  return undefined;
}

function budgetExceededResult(
  deps: ClaudeInvokeDeps,
  request: AIInvocationRequest,
  redaction: RedactionResult,
  requestedAt: Date,
  reason: string,
): AIInvocationResult {
  const provenance = buildProvenance({
    deps,
    request,
    redaction,
    tokenUsage: { input: 0, output: 0, total: 0 },
    outputText: "<budget-exceeded>",
    requestedAt,
    completedAt: requestedAt,
  });
  return {
    outcome: "budget-exceeded",
    diagnostics: [
      { code: "BUDGET_EXCEEDED", message: reason, severity: "error" },
    ],
    provenance,
    traceEvents: [],
    correlationId: request.correlationId,
  };
}

function unsupportedContractResult(
  deps: ClaudeInvokeDeps,
  request: AIInvocationRequest,
  requestedAt: Date,
): AIInvocationResult | undefined {
  const supported = deps.capabilities.supportedResponseContracts;
  if (supported.includes(request.responseContract.kind)) {
    return undefined;
  }
  const redaction: RedactionResult = {
    redactedInputs: request.inputs,
    redactions: [],
  };
  const provenance = buildProvenance({
    deps,
    request,
    redaction,
    tokenUsage: { input: 0, output: 0, total: 0 },
    outputText: "<contract-unsupported>",
    requestedAt,
    completedAt: requestedAt,
  });
  return {
    outcome: "failed",
    diagnostics: [
      {
        code: "CONTRACT_UNSUPPORTED",
        message: `adapter binding ${deps.capabilities.binding} does not support response contract kind "${request.responseContract.kind}" (supports: ${supported.join(", ")})`,
        severity: "error",
      },
    ],
    provenance,
    traceEvents: [],
    correlationId: request.correlationId,
  };
}

function abortedResult(
  deps: ClaudeInvokeDeps,
  request: AIInvocationRequest,
  requestedAt: Date,
  redaction?: RedactionResult,
): AIInvocationResult {
  const r =
    redaction ??
    ({ redactedInputs: request.inputs, redactions: [] } satisfies RedactionResult);
  const provenance = buildProvenance({
    deps,
    request,
    redaction: r,
    tokenUsage: { input: 0, output: 0, total: 0 },
    outputText: "<aborted>",
    requestedAt,
    completedAt: requestedAt,
  });
  return {
    outcome: "failed",
    diagnostics: [
      {
        code: "ABORTED",
        message: "invocation aborted",
        severity: "warn",
      },
    ],
    provenance,
    traceEvents: [],
    correlationId: request.correlationId,
  };
}

function failedResult(
  deps: ClaudeInvokeDeps,
  request: AIInvocationRequest,
  redaction: RedactionResult,
  requestedAt: Date,
  completedAt: Date,
  err: unknown,
): AIInvocationResult {
  const message = errorMessage(err);
  const provenance = buildProvenance({
    deps,
    request,
    redaction,
    tokenUsage: { input: 0, output: 0, total: 0 },
    outputText: "<failed>",
    requestedAt,
    completedAt,
  });
  return {
    outcome: "failed",
    diagnostics: [
      { code: "UPSTREAM_ERROR", message, severity: "error" },
    ],
    provenance,
    traceEvents: [],
    correlationId: request.correlationId,
  };
}

interface BuildProvenanceInput {
  readonly deps: ClaudeInvokeDeps;
  readonly request: AIInvocationRequest;
  readonly redaction: RedactionResult;
  readonly tokenUsage: { input: number; output: number; total: number };
  readonly outputText: string;
  readonly requestedAt: Date;
  readonly completedAt: Date;
}

export function buildProvenance(
  input: BuildProvenanceInput,
): AIProvenanceRecord {
  const { deps, request, redaction, tokenUsage, outputText, requestedAt, completedAt } =
    input;
  const wallClockMs = Math.max(
    0,
    completedAt.getTime() - requestedAt.getTime(),
  );
  const record: AIProvenanceRecord = {
    aiProvenanceVersion: "0.1",
    modelBinding: deps.capabilities.binding,
    modelName: deps.capabilities.modelName,
    modelVersion: deps.capabilities.modelVersion,
    ...(deps.capabilities.modelProviderRegion !== undefined
      ? { modelProviderRegion: deps.capabilities.modelProviderRegion }
      : {}),
    promptTemplateRef: request.promptTemplateRef,
    promptTemplateVersion: request.promptTemplateVersion,
    promptTemplateHash: sha256Hex(
      `${request.promptTemplateRef}@${request.promptTemplateVersion}`,
    ),
    inputHash: sha256Hex(canonicalJson(redaction.redactedInputs)),
    outputHash: sha256Hex(outputText),
    tokenUsage,
    wallClockMs,
    requestedAt: requestedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    requestingAgent: request.requestingAgent,
    redactions: redaction.redactions,
  };
  return record;
}

/** Convenience helper for the ready-made default rule set. */
export function coalesceRedactionRules(
  supplied: readonly RedactionRule[] | undefined,
): readonly RedactionRule[] {
  return supplied ?? defaultRedactionRules;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    const s = JSON.stringify(err);
    if (s !== undefined) return s;
  } catch {
    // fall through
  }
  return Object.prototype.toString.call(err);
}
