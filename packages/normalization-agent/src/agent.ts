/**
 * BIM \u2192 AIM Normalization Agent (Phase 1, WS-1.3).
 *
 * Traces to ADR-011 (BIM vs AIM boundary), ADR-015 (AI adapter contract).
 */

import type {
  AIInvocationContext,
  AIInvocationRequest,
  AIInvocationResult,
  AIModelAdapter,
  Diagnostic,
} from "@appbana/adapter-ai-contract";
import { assertProvenance } from "@appbana/ai-provenance-store";
import type { AIProvenanceStore } from "@appbana/ai-provenance-store";
import type { PromptRegistry } from "@appbana/prompt-template-registry";
import {
  RenderError,
  renderPrompt,
  resolveTemplate,
} from "@appbana/prompt-template-registry";

import { canonicalizeJson, contentHash } from "./hash.js";
import type {
  AimDocument,
  AimValidator,
  NormalizeBimInput,
  NormalizeBimResult,
  NormalizeDiagnostic,
} from "./types.js";
import { UNRESOLVED_SENTINEL } from "./types.js";

/** Static configuration \u2014 constructed once at kernel startup. */
export interface NormalizationAgentConfig {
  readonly adapter: AIModelAdapter;
  readonly provenanceStore: AIProvenanceStore;
  readonly registry: PromptRegistry;
  readonly aimValidator: AimValidator;
  /**
   * Kernel-supplied invocation context factory. The agent injects tenant +
   * abort signal at call time; the factory owns the rest (trace context,
   * app/cam ids, environment, clock).
   */
  readonly buildInvocationContext: (input: NormalizeBimInput) => AIInvocationContext;
  /** Default prompt ref \u2014 `"prompt.normalization-agent.bim-to-aim"`. */
  readonly defaultPromptRef?: string;
  /** Default prompt version \u2014 `"1.0.0"`. */
  readonly defaultPromptVersion?: string;
}

const DEFAULT_PROMPT_REF = "prompt.normalization-agent.bim-to-aim";
const DEFAULT_PROMPT_VERSION = "1.0.0";

export async function normalizeBim(
  input: NormalizeBimInput,
  config: NormalizationAgentConfig,
): Promise<NormalizeBimResult> {
  const promptRef = input.promptRef ?? config.defaultPromptRef ?? DEFAULT_PROMPT_REF;
  const promptVersion =
    input.promptVersion ?? config.defaultPromptVersion ?? DEFAULT_PROMPT_VERSION;

  // 1. Resolve template + render locally (needed for renderedPromptHash + audit).
  let template;
  try {
    template = resolveTemplate(config.registry, promptRef, promptVersion);
  } catch (err) {
    if (err instanceof RenderError) {
      throw new NormalizationAgentError(
        "PROMPT_TEMPLATE_MISSING",
        `prompt template ${promptRef}@${promptVersion} not found in registry`,
      );
    }
    throw err;
  }

  const bimCanonical = canonicalizeJson(input.bim);
  const bimContentHash = contentHash(input.bim);

  const rendered = renderPrompt(
    config.registry,
    {
      ref: promptRef,
      version: promptVersion,
      variables: { tenantName: input.tenantName, bimJson: bimCanonical },
    },
  );

  // 2. Build the AI request.
  const request = buildRequest({
    input,
    promptRef,
    promptVersion,
    bimCanonical,
  });

  // 3. Invoke the adapter.
  const ctx = enrichContext(config.buildInvocationContext(input), input.abortSignal);
  const result = await config.adapter.invoke(request, ctx);

  // 4. Kernel guard \u2014 refuse any result without a valid provenance record.
  assertProvenance(result);

  // 5. Persist provenance.
  const stored = await config.provenanceStore.record(result.provenance);

  // 6. Map adapter outcome \u2192 normalization outcome.
  const base = buildBaseResult({
    template,
    rendered,
    bimContentHash,
    promptRef,
    promptVersion,
    result,
    storedId: stored.id,
  });

  if (result.outcome === "budget-exceeded") {
    return { ...base, outcome: "ai-budget-exceeded", diagnostics: mapDiagnostics(result.diagnostics) };
  }
  if (result.outcome === "refused") {
    return { ...base, outcome: "ai-refused", diagnostics: mapDiagnostics(result.diagnostics) };
  }
  if (result.outcome === "failed") {
    return { ...base, outcome: "ai-failed", diagnostics: mapDiagnostics(result.diagnostics) };
  }
  if (result.outcome === "schema-invalid") {
    return { ...base, outcome: "schema-invalid", diagnostics: mapDiagnostics(result.diagnostics) };
  }

  // outcome === "accepted"
  const candidate = result.artifact;
  if (!isPlainObject(candidate)) {
    return {
      ...base,
      outcome: "schema-invalid",
      diagnostics: [
        {
          code: "NORMALIZATION_NON_OBJECT_ARTIFACT",
          message: `expected structured-output artifact to be a JSON object, got ${typeof candidate}`,
          severity: "error",
        },
      ],
    };
  }

  const schemaCheck = config.aimValidator(candidate);
  if (!schemaCheck.valid) {
    return {
      ...base,
      outcome: "schema-invalid",
      diagnostics: schemaCheck.errors.map((e) => ({
        code: "NORMALIZATION_SCHEMA_VIOLATION",
        path: e.path,
        message: e.message,
        severity: "error",
        detail: e.detail,
      })),
    };
  }

  const unresolved = findUnresolvedPaths(candidate);
  if (unresolved.length > 0) {
    return {
      ...base,
      outcome: "unresolved-fields",
      aim: candidate as AimDocument,
      diagnostics: unresolved.map((path) => ({
        code: "NORMALIZATION_UNRESOLVED_FIELD",
        path,
        message: `AIM field at ${path} carries the ${UNRESOLVED_SENTINEL} sentinel \u2014 the source BIM did not provide enough information to derive it`,
        severity: "error",
      })),
    };
  }

  return {
    ...base,
    outcome: "produced",
    aim: candidate as AimDocument,
    diagnostics: [],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface BuildRequestArgs {
  readonly input: NormalizeBimInput;
  readonly promptRef: string;
  readonly promptVersion: string;
  readonly bimCanonical: string;
}

function buildRequest(args: BuildRequestArgs): AIInvocationRequest {
  const { input, promptRef, promptVersion, bimCanonical } = args;
  return {
    promptTemplateRef: promptRef,
    promptTemplateVersion: promptVersion,
    inputs: {
      tenantName: input.tenantName,
      bimJson: bimCanonical,
    },
    responseContract: { kind: "json-schema", schema: EMPTY_SCHEMA },
    budget: input.budget ?? {},
    correlationId: input.correlationId,
    requestingAgent: "agent.normalization",
  };
}

/**
 * The adapter is given `EMPTY_SCHEMA` in the response contract because AIM
 * schema validation happens client-side in the agent \u2014 the agent owns the
 * canonical validator and does not trust adapter-side shape checks alone.
 * The empty schema is still legal per JSON Schema 2020-12 (accepts any value)
 * so adapters that do shape-only validation see an unconstrained contract.
 */
const EMPTY_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({});

function enrichContext(
  base: AIInvocationContext,
  signal: AbortSignal | undefined,
): AIInvocationContext {
  if (signal === undefined) return base;
  return { ...base, signal };
}

interface BuildBaseResultArgs {
  readonly template: { readonly sha256: string };
  readonly rendered: { readonly hash: string };
  readonly bimContentHash: string;
  readonly promptRef: string;
  readonly promptVersion: string;
  readonly result: AIInvocationResult;
  readonly storedId: string;
}

function buildBaseResult(args: BuildBaseResultArgs): Omit<NormalizeBimResult, "outcome" | "diagnostics"> {
  const { template, rendered, bimContentHash, promptRef, promptVersion, result, storedId } = args;
  return {
    promptRef,
    promptVersion,
    promptTemplateHash: template.sha256,
    renderedPromptHash: rendered.hash,
    bimContentHash,
    ai: {
      provenanceId: storedId,
      adapterOutcome: result.outcome,
      wallClockMs: result.provenance.wallClockMs,
      tokenUsage: result.provenance.tokenUsage,
      correlationId: result.correlationId,
    },
  };
}

function mapDiagnostics(diagnostics: readonly Diagnostic[]): readonly NormalizeDiagnostic[] {
  return diagnostics.map((d) => ({
    code: d.code,
    message: d.message,
    severity: d.severity === "error" ? "error" : "warning",
  }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Depth-first search for {@link UNRESOLVED_SENTINEL} anywhere in the AIM.
 * Reports the JSON Pointer to each carrier.
 */
export function findUnresolvedPaths(candidate: unknown): readonly string[] {
  const out: string[] = [];
  walk(candidate, "", out);
  return out;
}

function walk(value: unknown, path: string, out: string[]): void {
  if (typeof value === "string") {
    if (value.includes(UNRESOLVED_SENTINEL)) out.push(path === "" ? "/" : path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}/${i}`, out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, `${path}/${escapePointerToken(k)}`, out);
    }
  }
}

function escapePointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

export class NormalizationAgentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "NormalizationAgentError";
    this.code = code;
  }
}
