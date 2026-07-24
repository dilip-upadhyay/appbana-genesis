import { strict as assert } from "node:assert";
import { test } from "node:test";

import type {
  AIInvocationContext,
  AIInvocationRequest,
} from "@appbana/adapter-ai-contract";

import {
  LLAMA_STRUCTURED_OUTPUT_BINDING,
  createLocalLlamaStructuredOutputAdapter,
} from "../dist/index.js";

import { createFakeLocalLlamaClient } from "./fake-client.ts";

const NOW = () => new Date("2026-07-24T00:00:00.000Z");
const CTX: AIInvocationContext = {
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
};

function makeRequest(
  schema: Readonly<Record<string, unknown>>,
  overrides: Partial<AIInvocationRequest> = {},
): AIInvocationRequest {
  const base: AIInvocationRequest = {
    promptTemplateRef: "prompt.structured.smoke",
    promptTemplateVersion: "1.0.0",
    inputs: { customerName: "Jane" },
    responseContract: { kind: "json-schema", schema },
    budget: {},
    correlationId: "00000000-0000-4000-8000-0000000000bb",
    requestingAgent: "agent.test",
    ...overrides,
  };
  return base;
}

async function initAdapter(behavior = {}) {
  const fake = createFakeLocalLlamaClient(behavior);
  const adapter = createLocalLlamaStructuredOutputAdapter({
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

test("binding + kind reflect structured-output", async () => {
  const { adapter } = await initAdapter();
  assert.equal(adapter.binding, LLAMA_STRUCTURED_OUTPUT_BINDING);
  assert.equal(adapter.kind, "structured-output");
  assert.equal(adapter.capabilities.supportsStructuredOutput, true);
  assert.equal(adapter.capabilities.requiresNetwork, false);
});

test("valid JSON matching schema returns accepted with parsed artifact", async () => {
  const schema = { type: "object", required: ["ok"] };
  const { adapter } = await initAdapter({
    responseText: JSON.stringify({ ok: true, count: 3 }),
  });
  const result = await adapter.invoke(makeRequest(schema), CTX);
  assert.equal(result.outcome, "accepted");
  assert.deepEqual(result.artifact, { ok: true, count: 3 });
});

test("invalid JSON returns schema-invalid / INVALID_JSON", async () => {
  const { adapter } = await initAdapter({ responseText: "not json" });
  const result = await adapter.invoke(makeRequest({ type: "object" }), CTX);
  assert.equal(result.outcome, "schema-invalid");
  assert.equal(result.diagnostics[0]?.code, "INVALID_JSON");
});

test("schema shape mismatch returns SCHEMA_SHAPE_MISMATCH", async () => {
  const schema = { type: "object", required: ["customerId"] };
  const { adapter } = await initAdapter({
    responseText: JSON.stringify({ notCustomerId: "abc" }),
  });
  const result = await adapter.invoke(makeRequest(schema), CTX);
  assert.equal(result.outcome, "schema-invalid");
  assert.equal(result.diagnostics[0]?.code, "SCHEMA_SHAPE_MISMATCH");
});

test("response_format is set to json_object on the wire", async () => {
  const { adapter, fake } = await initAdapter({
    responseText: JSON.stringify({ ok: true }),
  });
  await adapter.invoke(makeRequest({ type: "object" }), CTX);
  assert.deepEqual(fake.calls[0]?.request.response_format, {
    type: "json_object",
  });
});

test("schema is embedded in the system prompt", async () => {
  const schema = { type: "object", required: ["ok"] };
  const { adapter, fake } = await initAdapter({
    responseText: JSON.stringify({ ok: true }),
  });
  await adapter.invoke(makeRequest(schema), CTX);
  const system = fake.calls[0]?.request.messages[0]?.content ?? "";
  assert.match(system, /JSON Schema/);
  assert.ok(system.includes(JSON.stringify(schema)));
});

test("empty response returns EMPTY_RESPONSE", async () => {
  const { adapter } = await initAdapter({ responseText: "" });
  const result = await adapter.invoke(makeRequest({ type: "object" }), CTX);
  assert.equal(result.outcome, "schema-invalid");
  assert.equal(result.diagnostics[0]?.code, "EMPTY_RESPONSE");
});
