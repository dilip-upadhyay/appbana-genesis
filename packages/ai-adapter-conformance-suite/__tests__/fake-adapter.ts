/**
 * Deterministic in-memory fake adapter used to prove the conformance runner.
 *
 * Not a template for real adapters — its purpose is to pass every Tier A
 * assertion the suite makes so that a green runner test proves the harness
 * itself, not the fake. The exception: `supportsStreaming` is intentionally
 * false so B.5 exercises the "no `invokeStream` present" branch.
 */

import { createHash } from "node:crypto";

import type {
  AIAdapterCapabilities,
  AIAdapterConfig,
  AIAdapterHealth,
  AIAdapterInitContext,
  AIInvocationContext,
  AIInvocationRequest,
  AIInvocationResult,
  AIModelAdapter,
  AIProvenanceRecord,
  Diagnostic,
} from "@appbana/adapter-ai-contract";

const REGION = "local";

export interface FakeAdapterOverrides {
  readonly binding?: string;
  readonly capabilities?: Partial<AIAdapterCapabilities>;
  /** When set, `correlationId` on results is REPLACED with this value — used to force C.7 failure. */
  readonly forceCorrelationId?: string;
}

export function makeFakeAdapter(
  overrides: FakeAdapterOverrides = {},
): AIModelAdapter<"text-generation"> {
  const binding = overrides.binding ?? "ai:fake-echo";
  const capabilities: AIAdapterCapabilities = {
    kind: "text-generation",
    binding,
    modelName: "fake-echo",
    modelVersion: "0.1.0",
    modelProviderRegion: REGION,
    supportedResponseContracts: ["free-text", "json-schema"],
    maxContextTokens: 4096,
    maxOutputTokens: 1024,
    supportsStreaming: false,
    supportsToolUse: false,
    supportsStructuredOutput: true,
    supportsDeterminismHint: true,
    requiresNetwork: false,
    egressesInputsToThirdParty: false,
    dataResidencyGuarantee: REGION,
    costPerInputToken: 0.000_01,
    costPerOutputToken: 0.000_02,
    conformanceTier: "A",
    adapterVersion: "0.1.0",
    minPlatformKernelVersion: "0.1.0",
    ...overrides.capabilities,
  };

  const adapter: AIModelAdapter<"text-generation"> = {
    kind: "text-generation",
    binding,
    capabilities,

    async init(_config: AIAdapterConfig, _ctx: AIAdapterInitContext) {
      // no-op
    },

    async invoke(
      request: AIInvocationRequest,
      ctx: AIInvocationContext,
    ): Promise<AIInvocationResult> {
      const requestedAt = ctx.now().toISOString();

      const provenanceBase = {
        aiProvenanceVersion: "0.1" as const,
        modelBinding: binding,
        modelName: capabilities.modelName,
        modelVersion: capabilities.modelVersion,
        modelProviderRegion: REGION,
        promptTemplateRef: request.promptTemplateRef,
        promptTemplateVersion: request.promptTemplateVersion,
        promptTemplateHash: sha256(
          `${request.promptTemplateRef}@${request.promptTemplateVersion}`,
        ),
        inputHash: sha256(canonicalJson(request.inputs)),
        requestingAgent: request.requestingAgent,
      };

      // 1. Abort — return quickly, do not throw.
      if (ctx.signal?.aborted === true) {
        const provenance: AIProvenanceRecord = {
          ...provenanceBase,
          outputHash: sha256("<aborted>"),
          tokenUsage: { input: 0, output: 0, total: 0 },
          wallClockMs: 0,
          requestedAt,
          completedAt: requestedAt,
          redactions: [],
        };
        return {
          outcome: "failed",
          diagnostics: [
            {
              code: "ABORTED",
              message: "invocation aborted before request was issued",
              severity: "warn",
            },
          ],
          provenance,
          traceEvents: [],
          correlationId: overrides.forceCorrelationId ?? request.correlationId,
        };
      }

      // 2. Response-contract validation.
      if (
        !capabilities.supportedResponseContracts.includes(
          request.responseContract.kind,
        )
      ) {
        const diagnostics: readonly Diagnostic[] = [
          {
            code: "UNSUPPORTED_RESPONSE_CONTRACT",
            message: `adapter does not support ${request.responseContract.kind}`,
            severity: "error",
          },
        ];
        const provenance: AIProvenanceRecord = {
          ...provenanceBase,
          outputHash: sha256("<unsupported-contract>"),
          tokenUsage: { input: 0, output: 0, total: 0 },
          wallClockMs: 0,
          requestedAt,
          completedAt: requestedAt,
          redactions: [],
        };
        return {
          outcome: "schema-invalid",
          diagnostics,
          provenance,
          traceEvents: [],
          correlationId: overrides.forceCorrelationId ?? request.correlationId,
        };
      }

      // 3. Redaction — very simple substring rule.
      const redactions = buildRedactions(request.inputs);
      const redactedInputs = applyRedactions(request.inputs);

      // 4. Deterministic echo.
      const artifact = canonicalJson(redactedInputs);
      const inputTokens = tokenize(canonicalJson(redactedInputs));
      const outputTokens = tokenize(artifact);
      const tokenUsage = {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      };

      // 5. Budget enforcement.
      const cost =
        (capabilities.costPerInputToken ?? 0) * tokenUsage.input +
        (capabilities.costPerOutputToken ?? 0) * tokenUsage.output;
      if (
        request.budget.maxCostUsd !== undefined &&
        cost > request.budget.maxCostUsd
      ) {
        const provenance: AIProvenanceRecord = {
          ...provenanceBase,
          outputHash: sha256("<budget-exceeded>"),
          tokenUsage,
          wallClockMs: 0,
          requestedAt,
          completedAt: requestedAt,
          redactions,
        };
        return {
          outcome: "budget-exceeded",
          diagnostics: [
            {
              code: "BUDGET_EXCEEDED",
              message: `estimated cost ${cost} > maxCostUsd ${request.budget.maxCostUsd}`,
              severity: "error",
            },
          ],
          provenance,
          traceEvents: [],
          correlationId: overrides.forceCorrelationId ?? request.correlationId,
        };
      }

      // 6. Happy path.
      const seedSuffix = request.seed === undefined ? "" : `#${request.seed}`;
      const provenance: AIProvenanceRecord = {
        ...provenanceBase,
        outputHash: sha256(`${artifact}${seedSuffix}`),
        tokenUsage,
        wallClockMs: 1,
        requestedAt,
        completedAt: requestedAt,
        redactions,
      };
      return {
        outcome: "accepted",
        artifact,
        diagnostics: [],
        provenance,
        traceEvents: [],
        correlationId: overrides.forceCorrelationId ?? request.correlationId,
      };
    },

    async shutdown() {
      // no-op
    },

    async health(): Promise<AIAdapterHealth> {
      return {
        state: "healthy",
        summary: "fake echo adapter",
        checkedAt: new Date("2026-07-24T00:00:00.000Z").toISOString(),
      };
    },
  };

  return adapter;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function tokenize(text: string): number {
  // Cheap deterministic token estimate — good enough for budget arithmetic.
  return Math.max(1, Math.ceil(text.length / 4));
}

function buildRedactions(inputs: Readonly<Record<string, unknown>>) {
  const out: Array<{
    path: string;
    classification: string;
    action: "masked";
  }> = [];
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === "string" && value.includes("SSN:")) {
      out.push({
        path: `/inputs/${key}`,
        classification: "pii.high",
        action: "masked",
      });
    }
  }
  return out;
}

function applyRedactions(
  inputs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    out[key] =
      typeof value === "string" && value.includes("SSN:")
        ? "[REDACTED]"
        : value;
  }
  return out;
}
