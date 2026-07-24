/**
 * End-to-end tests for `normalizeBim()` using an in-memory provenance store,
 * the shipped prompt registry, the shipped AIM schema, and a fake AI adapter.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { InMemoryAIProvenanceStore } from "@appbana/ai-provenance-store";
import { loadRegistry } from "@appbana/prompt-template-registry";

import {
  createAjvAimValidator,
  normalizeBim,
  UNRESOLVED_SENTINEL,
  type NormalizationAgentConfig,
  type NormalizeBimInput,
} from "../dist/index.js";
import { makeFakeAdapter } from "./fake-adapter.ts";
import {
  AIM_SCHEMA_PATH,
  CUSTOMER_ONBOARDING_AIM_PATH,
  CUSTOMER_ONBOARDING_BIM_PATH,
  PROMPT_REGISTRY_PATH,
  clone,
  loadJson,
} from "./fixtures.ts";

async function buildConfig(overrides: Partial<NormalizationAgentConfig> & {
  readonly adapter?: NormalizationAgentConfig["adapter"];
} = {}): Promise<NormalizationAgentConfig> {
  const registry = await loadRegistry(PROMPT_REGISTRY_PATH);
  const aimValidator = createAjvAimValidator({ schema: loadJson(AIM_SCHEMA_PATH) });
  return {
    adapter:
      overrides.adapter ??
      makeFakeAdapter({
        artifact: loadJson(CUSTOMER_ONBOARDING_AIM_PATH),
      }),
    provenanceStore: overrides.provenanceStore ?? new InMemoryAIProvenanceStore(),
    registry,
    aimValidator,
    buildInvocationContext: (input) => ({
      tenantId: input.tenantId,
      appId: "app.customer-onboarding",
      camId: "cam.customer-onboarding",
      camVersion: "0.1.0",
      environment: "dev",
      traceContext: {
        traceId: "trace-00000000000000000000000000000001",
        spanId: "span-0000000000000001",
      },
      now: () => new Date("2026-07-25T10:00:00.000Z"),
    }),
    ...(overrides.defaultPromptRef !== undefined ? { defaultPromptRef: overrides.defaultPromptRef } : {}),
    ...(overrides.defaultPromptVersion !== undefined ? { defaultPromptVersion: overrides.defaultPromptVersion } : {}),
  };
}

function baseInput(): NormalizeBimInput {
  return {
    bim: loadJson(CUSTOMER_ONBOARDING_BIM_PATH),
    tenantId: "tenant.acme",
    tenantName: "Acme Bank",
    correlationId: "corr-00000000000000000000000000000001",
  };
}

describe("normalizeBim: produced (happy path)", () => {
  it("returns outcome=produced with a schema-valid AIM and stored provenance", async () => {
    const store = new InMemoryAIProvenanceStore();
    const config = await buildConfig({ provenanceStore: store });
    const result = await normalizeBim(baseInput(), config);

    assert.equal(result.outcome, "produced", JSON.stringify(result.diagnostics, null, 2));
    assert.deepEqual(result.diagnostics, []);
    assert.ok(result.aim !== undefined);
    assert.equal(result.aim!["aimVersion"], "0.1.0");
    assert.equal(result.promptRef, "prompt.normalization-agent.bim-to-aim");
    assert.equal(result.promptVersion, "1.0.0");
    assert.match(result.bimContentHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.promptTemplateHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.renderedPromptHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(result.ai.adapterOutcome, "accepted");
    assert.equal(result.ai.correlationId, "corr-00000000000000000000000000000001");

    // Provenance was actually persisted
    const stored = await store.get(result.ai.provenanceId);
    assert.ok(stored !== undefined);
    assert.equal(stored!.record.tenantId, "tenant.acme");
    assert.equal(stored!.record.requestingAgent, "agent.normalization");
    assert.equal(stored!.record.aiProvenanceVersion, "0.2");
  });

  it("is deterministic \u2014 identical BIM produces identical bimContentHash", async () => {
    const config = await buildConfig();
    const r1 = await normalizeBim(baseInput(), config);
    const r2 = await normalizeBim(baseInput(), await buildConfig());
    assert.equal(r1.bimContentHash, r2.bimContentHash);
    assert.equal(r1.promptTemplateHash, r2.promptTemplateHash);
    assert.equal(r1.renderedPromptHash, r2.renderedPromptHash);
  });
});

describe("normalizeBim: schema-invalid", () => {
  it("maps a broken AIM candidate to outcome=schema-invalid with AJV errors", async () => {
    const broken = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    delete broken["operations"]; // required top-level field
    const config = await buildConfig({
      adapter: makeFakeAdapter({ artifact: broken }),
    });
    const result = await normalizeBim(baseInput(), config);

    assert.equal(result.outcome, "schema-invalid");
    assert.ok(result.aim === undefined);
    assert.ok(result.diagnostics.length > 0);
    assert.ok(
      result.diagnostics.every((d) => d.code === "NORMALIZATION_SCHEMA_VIOLATION"),
    );
  });

  it("rejects a non-object artifact as schema-invalid", async () => {
    const config = await buildConfig({
      adapter: makeFakeAdapter({ artifact: "just a string" }),
    });
    const result = await normalizeBim(baseInput(), config);
    assert.equal(result.outcome, "schema-invalid");
    assert.equal(
      result.diagnostics[0]?.code,
      "NORMALIZATION_NON_OBJECT_ARTIFACT",
    );
  });
});

describe("normalizeBim: unresolved-fields", () => {
  it("detects [UNRESOLVED] anywhere in the AIM", async () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    aim["metadata"] = {
      ...(aim["metadata"] as Record<string, unknown>),
      description: `Onboarding capability description ${UNRESOLVED_SENTINEL}`,
    };
    const config = await buildConfig({
      adapter: makeFakeAdapter({ artifact: aim }),
    });
    const result = await normalizeBim(baseInput(), config);

    assert.equal(result.outcome, "unresolved-fields");
    assert.ok(result.aim !== undefined, "aim should still be returned so callers can inspect");
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0]?.code, "NORMALIZATION_UNRESOLVED_FIELD");
    assert.equal(result.diagnostics[0]?.path, "/metadata/description");
  });
});

describe("normalizeBim: adapter failure passthrough", () => {
  it("maps outcome=refused \u2192 ai-refused", async () => {
    const config = await buildConfig({
      adapter: makeFakeAdapter({
        outcome: "refused",
        diagnostics: [
          { code: "SAFETY_REFUSAL", message: "policy violation", severity: "error" },
        ],
      }),
    });
    const result = await normalizeBim(baseInput(), config);
    assert.equal(result.outcome, "ai-refused");
    assert.equal(result.diagnostics[0]?.code, "SAFETY_REFUSAL");
    assert.equal(result.aim, undefined);
  });

  it("maps outcome=budget-exceeded \u2192 ai-budget-exceeded", async () => {
    const config = await buildConfig({
      adapter: makeFakeAdapter({
        outcome: "budget-exceeded",
        diagnostics: [
          { code: "BUDGET_EXCEEDED", message: "would breach maxCostUsd", severity: "error" },
        ],
      }),
    });
    const result = await normalizeBim(baseInput(), config);
    assert.equal(result.outcome, "ai-budget-exceeded");
    assert.equal(result.diagnostics[0]?.code, "BUDGET_EXCEEDED");
  });

  it("maps outcome=failed \u2192 ai-failed", async () => {
    const config = await buildConfig({
      adapter: makeFakeAdapter({
        outcome: "failed",
        diagnostics: [
          { code: "UPSTREAM_5XX", message: "gateway timeout", severity: "error" },
        ],
      }),
    });
    const result = await normalizeBim(baseInput(), config);
    assert.equal(result.outcome, "ai-failed");
    assert.equal(result.diagnostics[0]?.code, "UPSTREAM_5XX");
  });

  it("still stores provenance on failure", async () => {
    const store = new InMemoryAIProvenanceStore();
    const config = await buildConfig({
      provenanceStore: store,
      adapter: makeFakeAdapter({
        outcome: "failed",
        diagnostics: [
          { code: "UPSTREAM_5XX", message: "gateway timeout", severity: "error" },
        ],
      }),
    });
    const result = await normalizeBim(baseInput(), config);
    const stored = await store.get(result.ai.provenanceId);
    assert.ok(stored !== undefined, "failure provenance must be persisted");
    assert.equal(stored!.record.tenantId, "tenant.acme");
  });
});

describe("normalizeBim: prompt template resolution", () => {
  it("passes the bare prompt ref (no :v suffix) to the adapter", async () => {
    let seenRef: string | undefined;
    let seenVersion: string | undefined;
    const config = await buildConfig({
      adapter: makeFakeAdapter({
        artifact: loadJson(CUSTOMER_ONBOARDING_AIM_PATH),
        onInvoke: (req) => {
          seenRef = req.promptTemplateRef;
          seenVersion = req.promptTemplateVersion;
        },
      }),
    });
    await normalizeBim(baseInput(), config);
    assert.equal(seenRef, "prompt.normalization-agent.bim-to-aim");
    assert.equal(seenVersion, "1.0.0");
  });

  it("throws NormalizationAgentError when the prompt template is unknown", async () => {
    const config = await buildConfig();
    await assert.rejects(
      () =>
        normalizeBim(
          { ...baseInput(), promptRef: "prompt.does.not-exist" },
          config,
        ),
      /prompt template prompt\.does\.not-exist@1\.0\.0 not found/,
    );
  });
});
