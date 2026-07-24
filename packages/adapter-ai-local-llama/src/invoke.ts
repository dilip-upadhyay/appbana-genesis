/**
 * Shared invocation core for both llama adapter kinds. Mirrors the Claude
 * adapter's `claudeInvoke` — duplicated (not shared) so each adapter package
 * ships without cross-adapter coupling. If a third adapter arrives, extract
 * this into a shared `@appbana/adapter-ai-runtime` helper.
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
import type { RedactionRule, RedactionResult } from "@appbana/security-redaction";
import { defaultRedactionRules, redact } from "@appbana/security-redaction";

import type {
  LocalLlamaChatRequest,
  LocalLlamaChatResponse,
  LocalLlamaClient,
} from "./client.js";
import { canonicalJson, estimateTokens, sha256Hex } from "./hashing.js";

export interface LlamaInvokeDeps {
  readonly client: LocalLlamaClient;
  readonly capabilities: AIAdapterCapabilities;
  readonly redactionRules: readonly RedactionRule[];
  readonly buildMessages: (
    request: AIInvocationRequest,
    redactedInputs: unknown,
  ) => {
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly responseFormat?: LocalLlamaChatRequest["response_format"];
  };
  readonly parseResponse: (
    request: AIInvocationRequest,
    response: LocalLlamaChatResponse,
  ) => {
    readonly outcome: AIAdapterInvocationOutcome;
    readonly artifact?: unknown;
    readonly diagnostics: readonly Diagnostic[];
  };
}

interface InvokeInternal {
  readonly deps: LlamaInvokeDeps;
  readonly request: AIInvocationRequest;
  readonly ctx: AIInvocationContext;
}

export async function llamaInvoke(
  internal: InvokeInternal,
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

  // 2. Redact inputs BEFORE any wire call — mandatory even for on-prem.
  const redaction: RedactionResult = redact(request.inputs, deps.redactionRules);

  // 3. Build prompts from the redacted view.
  const { systemPrompt, userPrompt, responseFormat } = deps.buildMessages(
    request,
    redaction.redactedInputs,
  );

  // 4. Budget pre-check. Local adapters have no cost, but callers may still
  //    supply `maxInputTokens`; enforce that.
  const budgetOutcome = budgetPreCheck({
    capabilities: deps.capabilities,
    systemPrompt,
    userPrompt,
    request,
  });
  if (budgetOutcome !== undefined) {
    return budgetOutcome(deps, request, redaction, requestedAt);
  }

  // 5. Fire.
  const chatRequest: LocalLlamaChatRequest = {
    model: deps.capabilities.modelName,
    max_tokens: pickMaxTokens(deps.capabilities, request),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
    ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
  };

  let response: LocalLlamaChatResponse;
  try {
    response = await deps.client.chatCompletions.create(
      chatRequest,
      ctx.signal !== undefined ? { signal: ctx.signal } : undefined,
    );
  } catch (err) {
    return failedResult(deps, request, redaction, requestedAt, ctx.now(), err);
  }

  // 6. Kind-specific response parsing.
  const parsed = deps.parseResponse(request, response);

  const completedAt = ctx.now();
  const outputText = response.choices.map((c) => c.message.content).join("");
  const provenance = buildProvenance({
    deps,
    request,
    redaction,
    tokenUsage: {
      input: response.usage.prompt_tokens,
      output: response.usage.completion_tokens,
      total: response.usage.total_tokens,
    },
    outputText,
    requestedAt,
    completedAt,
  });

  return {
    outcome: parsed.outcome,
    ...(parsed.artifact !== undefined ? { artifact: parsed.artifact } : {}),
    diagnostics: parsed.diagnostics,
    provenance,
    traceEvents: [],
    correlationId: request.correlationId,
  };
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

interface BudgetInput {
  readonly capabilities: AIAdapterCapabilities;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly request: AIInvocationRequest;
}

type BudgetFactory = (
  deps: LlamaInvokeDeps,
  request: AIInvocationRequest,
  redaction: RedactionResult,
  requestedAt: Date,
) => AIInvocationResult;

function budgetPreCheck(input: BudgetInput): BudgetFactory | undefined {
  const { capabilities, systemPrompt, userPrompt, request } = input;
  const estimatedInput =
    estimateTokens(systemPrompt) + estimateTokens(userPrompt);
  const budgetMaxInput = request.budget.maxInputTokens;
  if (budgetMaxInput !== undefined && estimatedInput > budgetMaxInput) {
    return (deps, req, redaction, requestedAt) =>
      budgetExceededResult(
        deps,
        req,
        redaction,
        requestedAt,
        `estimated input tokens (${estimatedInput}) exceed budget.maxInputTokens (${budgetMaxInput})`,
      );
  }
  // Local adapter has no cost fields, so no maxCostUsd enforcement.
  if (
    request.budget.maxCostUsd !== undefined &&
    capabilities.costPerInputToken !== undefined &&
    capabilities.costPerOutputToken !== undefined
  ) {
    const worstCaseOutput = pickMaxTokens(capabilities, request);
    const worstCaseCost =
      estimatedInput * capabilities.costPerInputToken +
      worstCaseOutput * capabilities.costPerOutputToken;
    if (worstCaseCost > request.budget.maxCostUsd) {
      return (deps, req, redaction, requestedAt) =>
        budgetExceededResult(
          deps,
          req,
          redaction,
          requestedAt,
          `worst-case cost ${worstCaseCost.toFixed(6)} USD exceeds budget.maxCostUsd (${request.budget.maxCostUsd})`,
        );
    }
  }
  return undefined;
}

function pickMaxTokens(
  capabilities: AIAdapterCapabilities,
  request: AIInvocationRequest,
): number {
  const budget = request.budget.maxOutputTokens ?? capabilities.maxOutputTokens;
  return Math.min(budget, capabilities.maxOutputTokens);
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

function budgetExceededResult(
  deps: LlamaInvokeDeps,
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
  deps: LlamaInvokeDeps,
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
  deps: LlamaInvokeDeps,
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
      { code: "ABORTED", message: "invocation aborted", severity: "warn" },
    ],
    provenance,
    traceEvents: [],
    correlationId: request.correlationId,
  };
}

function failedResult(
  deps: LlamaInvokeDeps,
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
  readonly deps: LlamaInvokeDeps;
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
  const residency =
    deps.capabilities.dataResidencyGuarantee ??
    deps.capabilities.modelProviderRegion;
  const record: AIProvenanceRecord = {
    aiProvenanceVersion: "0.1",
    modelBinding: deps.capabilities.binding,
    modelName: deps.capabilities.modelName,
    modelVersion: deps.capabilities.modelVersion,
    ...(residency !== undefined ? { modelProviderRegion: residency } : {}),
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
