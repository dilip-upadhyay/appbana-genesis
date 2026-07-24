/**
 * Test fixtures + fake AI adapter for the Normalization Agent tests.
 *
 * The fake adapter is a minimal implementation of the {@link AIModelAdapter}
 * contract that returns a caller-supplied artifact and a v0.2-compliant
 * provenance record. Used in place of a real network-touching adapter so
 * agent tests are deterministic + hermetic.
 */

import { createHash } from "node:crypto";

import type {
  AIAdapterCapabilities,
  AIAdapterInvocationOutcome,
  AIInvocationContext,
  AIInvocationRequest,
  AIInvocationResult,
  AIModelAdapter,
  AIProvenanceRecord,
  Diagnostic,
} from "@appbana/adapter-ai-contract";

export interface FakeAdapterConfig {
  readonly binding?: string;
  readonly modelName?: string;
  readonly modelVersion?: string;
  readonly outcome?: AIAdapterInvocationOutcome;
  readonly artifact?: unknown;
  readonly diagnostics?: readonly Diagnostic[];
  /** Simulated wall-clock latency in ms. Defaults to 42. */
  readonly wallClockMs?: number;
  /** Optional hook to observe invocations. */
  readonly onInvoke?: (
    req: AIInvocationRequest,
    ctx: AIInvocationContext,
  ) => void;
}

export function makeFakeAdapter(cfg: FakeAdapterConfig): AIModelAdapter {
  const binding = cfg.binding ?? "ai:fake";
  const modelName = cfg.modelName ?? "fake-model";
  const modelVersion = cfg.modelVersion ?? "0.0.0-test";
  const wallClockMs = cfg.wallClockMs ?? 42;

  const capabilities: AIAdapterCapabilities = {
    kind: "structured-output",
    binding,
    modelName,
    modelVersion,
    supportedResponseContracts: ["json-schema"],
    maxContextTokens: 100_000,
    maxOutputTokens: 8_000,
    supportsStreaming: false,
    supportsToolUse: false,
    supportsStructuredOutput: true,
    supportsDeterminismHint: true,
    requiresNetwork: false,
    egressesInputsToThirdParty: false,
    dataResidencyGuarantee: "on-prem",
    conformanceTier: "A",
    adapterVersion: "0.0.0-test",
    minPlatformKernelVersion: "0.1.0",
  };

  return {
    kind: "structured-output",
    binding,
    capabilities,
    async init() {
      // no-op
    },
    async invoke(request, ctx): Promise<AIInvocationResult> {
      cfg.onInvoke?.(request, ctx);
      const outcome = cfg.outcome ?? "accepted";
      const artifact = cfg.artifact;
      const requestedAt = ctx.now();
      const completedAt = new Date(requestedAt.getTime() + wallClockMs);
      const inputText = JSON.stringify(request.inputs);
      const outputText =
        outcome === "accepted" && artifact !== undefined
          ? JSON.stringify(artifact)
          : "";
      const provenance: AIProvenanceRecord = {
        aiProvenanceVersion: "0.2",
        tenantId: ctx.tenantId,
        modelBinding: binding,
        modelName,
        modelVersion,
        modelProviderRegion: "on-prem",
        promptTemplateRef: request.promptTemplateRef,
        promptTemplateVersion: request.promptTemplateVersion,
        promptTemplateHash: `sha256:${sha256Hex(request.promptTemplateRef + "@" + request.promptTemplateVersion)}`,
        inputHash: `sha256:${sha256Hex(inputText)}`,
        outputHash: `sha256:${sha256Hex(outputText)}`,
        tokenUsage: {
          input: Math.ceil(inputText.length / 4),
          output: Math.ceil(outputText.length / 4),
          total:
            Math.ceil(inputText.length / 4) + Math.ceil(outputText.length / 4),
        },
        wallClockMs,
        requestedAt: requestedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        requestingAgent: request.requestingAgent,
        redactions: [],
      };
      const base: AIInvocationResult = {
        outcome,
        diagnostics: cfg.diagnostics ?? [],
        provenance,
        traceEvents: [],
        correlationId: request.correlationId,
      };
      return outcome === "accepted" && artifact !== undefined
        ? { ...base, artifact }
        : base;
    },
    async shutdown() {
      // no-op
    },
    async health() {
      return {
        state: "healthy",
        summary: "fake adapter ready",
        checkedAt: new Date().toISOString(),
      };
    },
  };
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
