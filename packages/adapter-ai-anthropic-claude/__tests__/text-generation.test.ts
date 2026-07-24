/**
 * Text-generation adapter tests: exercise happy path, redaction, budget,
 * abort, error paths, and streaming — all against the deterministic fake
 * Anthropic client. No network.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import type {
  AIInvocationContext,
  AIInvocationRequest,
} from "@appbana/adapter-ai-contract";

import {
  CLAUDE_TEXT_GENERATION_BINDING,
  createClaudeTextGenerationAdapter,
} from "../dist/index.js";

import { createFakeAnthropicClient, type FakeAnthropicClient } from "./fake-client.ts";

const NOW = () => new Date("2026-07-24T00:00:00.000Z");

function makeCtx(overrides: Partial<AIInvocationContext> = {}): AIInvocationContext {
  const base: AIInvocationContext = {
    tenantId: "tenant.test",
    appId: "app.test",
    camId: "cam.test",
    camVersion: "0.1.0",
    environment: "dev",
    traceContext: {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
    },
    now: NOW,
    ...(overrides.region !== undefined ? { region: overrides.region } : {}),
    ...(overrides.signal !== undefined ? { signal: overrides.signal } : {}),
  };
  return base;
}

function makeRequest(overrides: Partial<AIInvocationRequest> = {}): AIInvocationRequest {
  const base: AIInvocationRequest = {
    promptTemplateRef: "prompt.text.smoke",
    promptTemplateVersion: "1.0.0",
    inputs: { message: "hello" },
    responseContract: { kind: "free-text" },
    budget: {},
    correlationId: "00000000-0000-4000-8000-0000000000aa",
    requestingAgent: "agent.test",
    ...overrides,
  };
  return base;
}

async function initAdapter(behavior = {}) {
  const fake: FakeAnthropicClient = createFakeAnthropicClient(behavior);
  const adapter = createClaudeTextGenerationAdapter({
    apiKey: "sk-test",
    clientFactory: async () => fake,
  });
  await adapter.init({}, {
    deploymentMode: "dedicated-cloud",
    platformKernelVersion: "0.1.0",
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });
  return { adapter, fake };
}

test("binding + capabilities are consistent with the manifest fixture", async () => {
  const { adapter } = await initAdapter();
  assert.equal(adapter.binding, CLAUDE_TEXT_GENERATION_BINDING);
  assert.equal(adapter.kind, "text-generation");
  assert.equal(adapter.capabilities.supportsStreaming, true);
  assert.equal(adapter.capabilities.requiresNetwork, true);
  assert.equal(adapter.capabilities.egressesInputsToThirdParty, true);
});

test("happy path returns accepted outcome with provenance", async () => {
  const { adapter, fake } = await initAdapter({ responseText: "Hello, world!" });
  const result = await adapter.invoke(makeRequest(), makeCtx());
  assert.equal(result.outcome, "accepted");
  assert.equal(result.artifact, "Hello, world!");
  assert.equal(result.correlationId, "00000000-0000-4000-8000-0000000000aa");
  assert.equal(result.provenance.modelBinding, CLAUDE_TEXT_GENERATION_BINDING);
  assert.equal(result.provenance.tokenUsage.total, 8);
  assert.match(
    result.provenance.outputHash,
    /^sha256:[0-9a-f]{64}$/,
  );
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]?.method, "create");
});

test("redaction runs BEFORE the wire call", async () => {
  const { adapter, fake } = await initAdapter();
  const result = await adapter.invoke(
    makeRequest({
      inputs: { message: "SSN is 123-45-6789 and email a@b.co" },
    }),
    makeCtx(),
  );
  assert.equal(result.provenance.redactions.length, 2);
  const wireContent = fake.calls[0]?.request.messages[0]?.content ?? "";
  assert.ok(!wireContent.includes("123-45-6789"));
  assert.ok(!wireContent.includes("a@b.co"));
  assert.ok(wireContent.includes("[REDACTED]"));
});

test("aborted signal returns outcome=failed without calling the client", async () => {
  const { adapter, fake } = await initAdapter();
  const controller = new AbortController();
  controller.abort();
  const result = await adapter.invoke(makeRequest(), makeCtx({ signal: controller.signal }));
  assert.equal(result.outcome, "failed");
  assert.equal(fake.calls.length, 0);
  assert.equal(result.diagnostics[0]?.code, "ABORTED");
});

test("budget breach returns outcome=budget-exceeded without calling the client", async () => {
  const { adapter, fake } = await initAdapter();
  const result = await adapter.invoke(
    makeRequest({ budget: { maxCostUsd: 1e-9 } }),
    makeCtx(),
  );
  assert.equal(result.outcome, "budget-exceeded");
  assert.equal(fake.calls.length, 0);
  assert.equal(result.diagnostics[0]?.code, "BUDGET_EXCEEDED");
});

test("upstream error surfaces as outcome=failed with UPSTREAM_ERROR diagnostic", async () => {
  const { adapter } = await initAdapter({
    throwOnCreate: new Error("rate limited"),
  });
  const result = await adapter.invoke(makeRequest(), makeCtx());
  assert.equal(result.outcome, "failed");
  assert.equal(result.diagnostics[0]?.code, "UPSTREAM_ERROR");
  assert.match(result.diagnostics[0]?.message ?? "", /rate limited/);
});

test("streaming yields deltas + one terminal chunk with provenance", async () => {
  const { adapter } = await initAdapter({
    streamChunks: ["Hello, ", "world", "!"],
  });
  assert.ok(typeof adapter.invokeStream === "function");
  const chunks = [];
  for await (const chunk of adapter.invokeStream!(makeRequest(), makeCtx())) {
    chunks.push(chunk);
  }
  const terminals = chunks.filter((c) => c.terminal);
  const deltas = chunks.filter((c) => !c.terminal);
  assert.equal(terminals.length, 1);
  assert.equal(deltas.length, 3);
  assert.equal(deltas.map((c) => c.delta).join(""), "Hello, world!");
  assert.equal(terminals[0]?.outcome, "accepted");
  assert.ok(terminals[0]?.provenance);
  assert.match(
    terminals[0]?.provenance?.outputHash ?? "",
    /^sha256:[0-9a-f]{64}$/,
  );
});

test("health reports healthy after init and unhealthy after shutdown", async () => {
  const { adapter } = await initAdapter();
  const h1 = await adapter.health();
  assert.equal(h1.state, "healthy");
  await adapter.shutdown();
  const h2 = await adapter.health();
  assert.equal(h2.state, "unhealthy");
});
