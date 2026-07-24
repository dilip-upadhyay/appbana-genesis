/**
 * Type-smoke test: exercises the barrel and instantiates a minimal stub adapter
 * to prove the interface is implementable end-to-end. Failing this test at
 * compile time (via `node --test --experimental-strip-types`) means the
 * contract has broken a downstream consumer.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  AI_ADAPTER_CONTRACT_VERSION,
  AI_PROVENANCE_VERSION,
  aiCapabilityKinds,
  aiHumanReviewStatuses,
  aiRedactionActions,
  aiResponseContractKinds,
  type AIAdapterCapabilities,
  type AIAdapterConfig,
  type AIAdapterHealth,
  type AIAdapterInitContext,
  type AIInvocationContext,
  type AIInvocationRequest,
  type AIInvocationResult,
  type AIModelAdapter,
  type AIProvenanceRecord,
} from "../dist/index.js";

test("contract version is 0.1.0", () => {
  assert.equal(AI_ADAPTER_CONTRACT_VERSION, "0.1.0");
});

test("provenance envelope version is 0.1", () => {
  assert.equal(AI_PROVENANCE_VERSION, "0.1");
});

test("five capability kinds are declared", () => {
  assert.deepEqual([...aiCapabilityKinds], [
    "text-generation",
    "structured-output",
    "embedding",
    "speech-to-text",
    "vision",
  ]);
});

test("five response contract kinds are declared", () => {
  assert.deepEqual([...aiResponseContractKinds], [
    "free-text",
    "json-schema",
    "tool-use",
    "embedding-vector",
    "transcript",
  ]);
});

test("redaction actions match ADR-015", () => {
  assert.deepEqual([...aiRedactionActions], [
    "removed",
    "masked",
    "hashed",
    "truncated",
  ]);
});

test("human-review statuses match ADR-015", () => {
  assert.deepEqual([...aiHumanReviewStatuses], [
    "pending",
    "approved",
    "rejected",
    "not-required",
  ]);
});

test("a minimal AIModelAdapter compiles and can be instantiated", async () => {
  const capabilities: AIAdapterCapabilities = {
    kind: "text-generation",
    binding: "ai:stub",
    modelName: "stub-model",
    modelVersion: "0.0.0",
    supportedResponseContracts: ["free-text"],
    maxContextTokens: 1024,
    maxOutputTokens: 256,
    supportsStreaming: false,
    supportsToolUse: false,
    supportsStructuredOutput: false,
    supportsDeterminismHint: false,
    requiresNetwork: false,
    egressesInputsToThirdParty: false,
    conformanceTier: "C",
    adapterVersion: "0.0.0",
    minPlatformKernelVersion: "0.0.0",
  };

  const stub: AIModelAdapter<"text-generation"> = {
    kind: "text-generation",
    binding: "ai:stub",
    capabilities,
    async init(_config: AIAdapterConfig, _ctx: AIAdapterInitContext): Promise<void> {
      // no-op
    },
    async invoke(
      request: AIInvocationRequest,
      _ctx: AIInvocationContext,
    ): Promise<AIInvocationResult> {
      const provenance: AIProvenanceRecord = {
        aiProvenanceVersion: "0.1",
        modelBinding: "ai:stub",
        modelName: "stub-model",
        modelVersion: "0.0.0",
        promptTemplateRef: request.promptTemplateRef,
        promptTemplateVersion: request.promptTemplateVersion,
        promptTemplateHash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        inputHash:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        outputHash:
          "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        tokenUsage: { input: 0, output: 0, total: 0 },
        wallClockMs: 0,
        requestedAt: "2026-07-24T00:00:00.000Z",
        completedAt: "2026-07-24T00:00:00.000Z",
        requestingAgent: request.requestingAgent,
        redactions: [],
      };

      return {
        outcome: "accepted",
        artifact: "hello",
        diagnostics: [],
        provenance,
        traceEvents: [],
        correlationId: request.correlationId,
      };
    },
    async shutdown(): Promise<void> {
      // no-op
    },
    async health(): Promise<AIAdapterHealth> {
      return {
        state: "healthy",
        summary: "stub adapter is always healthy",
        checkedAt: "2026-07-24T00:00:00.000Z",
      };
    },
  };

  assert.equal(stub.kind, "text-generation");
  assert.equal(stub.capabilities.conformanceTier, "C");

  const result = await stub.invoke(
    {
      promptTemplateRef: "prompt.test.smoke",
      promptTemplateVersion: "0.0.0",
      inputs: {},
      responseContract: { kind: "free-text" },
      budget: {},
      correlationId: "00000000-0000-4000-8000-000000000000",
      requestingAgent: "agent.ba-agent",
    },
    {
      tenantId: "tenant.test",
      appId: "app.test",
      camId: "cam.test",
      camVersion: "0.1.0",
      environment: "dev",
      traceContext: {
        traceId: "00000000000000000000000000000000",
        spanId: "0000000000000000",
      },
      now: () => new Date("2026-07-24T00:00:00Z"),
    },
  );

  assert.equal(result.outcome, "accepted");
  assert.equal(result.provenance.aiProvenanceVersion, "0.1");
  assert.equal(result.provenance.tokenUsage.total, 0);
  assert.equal(result.correlationId, "00000000-0000-4000-8000-000000000000");
});
