import { strict as assert } from "node:assert";
import { test } from "node:test";

import type {
  AIInvocationContext,
  AIInvocationRequest,
} from "@appbana/adapter-ai-contract";

import {
  DEFAULT_LLAMA_REGION,
  LLAMA_TEXT_GENERATION_BINDING,
  createLocalLlamaTextGenerationAdapter,
} from "../dist/index.js";

import { createFakeLocalLlamaClient, type FakeLocalLlamaClient } from "./fake-client.ts";

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
  const fake: FakeLocalLlamaClient = createFakeLocalLlamaClient(behavior);
  const adapter = createLocalLlamaTextGenerationAdapter({
    clientFactory: async () => fake,
  });
  await adapter.init({}, {
    deploymentMode: "air-gapped",
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

test("binding + capabilities are air-gapped-compliant", async () => {
  const { adapter } = await initAdapter();
  assert.equal(adapter.binding, LLAMA_TEXT_GENERATION_BINDING);
  assert.equal(adapter.kind, "text-generation");
  assert.equal(adapter.capabilities.requiresNetwork, false);
  assert.equal(adapter.capabilities.egressesInputsToThirdParty, false);
  assert.equal(adapter.capabilities.dataResidencyGuarantee, DEFAULT_LLAMA_REGION);
  assert.equal(adapter.capabilities.supportsDeterminismHint, true);
  assert.equal(adapter.capabilities.conformanceTier, "A");
});

test("default factory rejects at init when no clientFactory supplied", async () => {
  const adapter = createLocalLlamaTextGenerationAdapter();
  await assert.rejects(
    adapter.init({}, {
      deploymentMode: "air-gapped",
      platformKernelVersion: "0.1.0",
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    }),
    /does not bundle an HTTP client/,
  );
});

test("happy path returns accepted with provenance + on-prem region", async () => {
  const { adapter, fake } = await initAdapter({ responseText: "Hello, world!" });
  const result = await adapter.invoke(makeRequest(), makeCtx());
  assert.equal(result.outcome, "accepted");
  assert.equal(result.artifact, "Hello, world!");
  assert.equal(result.provenance.modelProviderRegion, DEFAULT_LLAMA_REGION);
  assert.equal(result.provenance.tokenUsage.total, 8);
  assert.equal(fake.calls.length, 1);
});

test("redaction runs before wire call", async () => {
  const { adapter, fake } = await initAdapter();
  await adapter.invoke(
    makeRequest({ inputs: { note: "SSN 123-45-6789 here" } }),
    makeCtx(),
  );
  const messages = fake.calls[0]?.request.messages ?? [];
  const wire = messages.map((m) => m.content).join(" ");
  assert.ok(!wire.includes("123-45-6789"));
});

test("same seed → same outputHash (Tier A determinism intent)", async () => {
  const seedMap = new Map<number, string>([[42, "deterministic reply"]]);
  const { adapter } = await initAdapter({ seedRoutedResponses: seedMap });
  const req1 = makeRequest({ seed: 42, correlationId: "00000000-0000-4000-8000-000000000001" });
  const req2 = makeRequest({ seed: 42, correlationId: "00000000-0000-4000-8000-000000000002" });
  const a = await adapter.invoke(req1, makeCtx());
  const b = await adapter.invoke(req2, makeCtx());
  assert.equal(a.outcome, "accepted");
  assert.equal(b.outcome, "accepted");
  assert.equal(a.provenance.outputHash, b.provenance.outputHash);
});

test("aborted signal short-circuits without calling the client", async () => {
  const { adapter, fake } = await initAdapter();
  const ctrl = new AbortController();
  ctrl.abort();
  const result = await adapter.invoke(makeRequest(), makeCtx({ signal: ctrl.signal }));
  assert.equal(result.outcome, "failed");
  assert.equal(fake.calls.length, 0);
  assert.equal(result.diagnostics[0]?.code, "ABORTED");
});

test("upstream error surfaces as UPSTREAM_ERROR", async () => {
  const { adapter } = await initAdapter({ throwOnCreate: new Error("connection refused") });
  const result = await adapter.invoke(makeRequest(), makeCtx());
  assert.equal(result.outcome, "failed");
  assert.equal(result.diagnostics[0]?.code, "UPSTREAM_ERROR");
  assert.match(result.diagnostics[0]?.message ?? "", /connection refused/);
});

test("streaming yields deltas + one terminal chunk", async () => {
  const { adapter } = await initAdapter({ streamChunks: ["Hel", "lo, ", "world!"] });
  assert.ok(typeof adapter.invokeStream === "function");
  const chunks = [];
  for await (const c of adapter.invokeStream!(makeRequest(), makeCtx())) {
    chunks.push(c);
  }
  const terminals = chunks.filter((c) => c.terminal);
  const deltas = chunks.filter((c) => !c.terminal);
  assert.equal(terminals.length, 1);
  assert.equal(deltas.length, 3);
  assert.equal(deltas.map((c) => c.delta).join(""), "Hello, world!");
  assert.equal(terminals[0]?.outcome, "accepted");
});

test("shutdown flips health to unhealthy", async () => {
  const { adapter } = await initAdapter();
  const h1 = await adapter.health();
  assert.equal(h1.state, "healthy");
  await adapter.shutdown();
  const h2 = await adapter.health();
  assert.equal(h2.state, "unhealthy");
});
