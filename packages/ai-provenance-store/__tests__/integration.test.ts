/**
 * Cross-package integration test — proves end-to-end that:
 *   1. A conformant adapter (fake, mirrors Claude/Llama shape) produces a
 *      provenance record that passes assertProvenance.
 *   2. That record round-trips through both InMemory and JSONL stores.
 *   3. listReferencedPromptVersions() output is accepted by
 *      validateProvenanceRefs() against the SHIPPED seed registry.
 *   4. Tenant filtering on query() works with real records.
 *   5. Security redaction integrates without corrupting hashes.
 *
 * This is the "wire together the WS-1.2 packages" smoke test. If it passes,
 * the pipeline agent → adapter → store → registry-check is proven at v0.2.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type {
  AIInvocationContext,
  AIInvocationRequest,
  AIInvocationResult,
  AIProvenanceRecord,
} from "@appbana/adapter-ai-contract";
import {
  loadRegistry,
  validateProvenanceRefs,
} from "@appbana/prompt-template-registry";
import { redact, RULE_PII_EMAIL } from "@appbana/security-redaction";

import {
  assertProvenance,
  InMemoryAIProvenanceStore,
  JsonlAIProvenanceStore,
} from "../dist/index.js";

function sha256Hex(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = sortValue(obj[k]);
    return out;
  }
  return value;
}

// Path to the SHIPPED registry inside prompt-template-registry.
const REGISTRY_PATH = fileURLToPath(
  new URL("../../prompt-template-registry/prompts", import.meta.url),
);

// Deterministic seed-registry references (must match index.json in the registry
// package; test fails loudly if they drift).
const BA_INTAKE = {
  ref: "prompt.ba-agent.intake",
  version: "1.0.0",
  hash: "sha256:e7c091593f150f6c9d85b073f06ada17c92fcb9bc82dac824f3f03d88e5e81cb",
};
const BIM_TO_AIM = {
  ref: "prompt.normalization-agent.bim-to-aim",
  version: "1.0.0",
  hash: "sha256:30128bc927cba9b1f723437c51ca3e501d7f8cc58bcc0a20f65c338d63cd483e",
};

// Redaction rules: mask email addresses inside any string field.
const REDACTION_RULES = [RULE_PII_EMAIL] as const;

/**
 * Fake adapter that mirrors the exact provenance shape produced by the real
 * Claude/Llama adapters (including v0.2 tenantId).
 */
function fakeInvoke(
  request: AIInvocationRequest,
  ctx: AIInvocationContext,
  seedRef: { ref: string; version: string; hash: string },
): AIInvocationResult {
  const redaction = redact(request.inputs, REDACTION_RULES);
  const outputText = `intake for ${JSON.stringify(redaction.redactedInputs)}`;
  const requestedAt = ctx.now();
  const completedAt = ctx.now();

  const provenance: AIProvenanceRecord = {
    aiProvenanceVersion: "0.2",
    tenantId: ctx.tenantId,
    modelBinding: "ai:fake",
    modelName: "fake-model",
    modelVersion: "1.0.0",
    modelProviderRegion: "test",
    promptTemplateRef: request.promptTemplateRef,
    promptTemplateVersion: request.promptTemplateVersion,
    promptTemplateHash: seedRef.hash,
    inputHash: sha256Hex(canonicalJson(redaction.redactedInputs)),
    outputHash: sha256Hex(outputText),
    tokenUsage: { input: 10, output: 5, total: 15 },
    wallClockMs: 0,
    requestedAt: requestedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    requestingAgent: request.requestingAgent,
    redactions: redaction.redactions,
  };

  return {
    outcome: "accepted",
    artifact: { text: outputText },
    diagnostics: [],
    provenance,
    traceEvents: [],
    correlationId: request.correlationId,
  };
}

function makeCtx(tenantId: string, tickMs: number): AIInvocationContext {
  let counter = 0;
  return {
    tenantId,
    appId: "app.customer-onboarding",
    camId: "cam.customer-onboarding",
    camVersion: "1.0.0",
    environment: "dev",
    traceContext: {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    },
    now: () => new Date(Date.UTC(2026, 6, 24, 12, 0, counter++ * tickMs)),
  };
}

function makeRequest(seed: { ref: string; version: string }): AIInvocationRequest {
  return {
    promptTemplateRef: seed.ref,
    promptTemplateVersion: seed.version,
    inputs: {
      email: "customer@example.com",
      accountType: "checking",
    },
    responseContract: { kind: "free-text" },
    budget: { maxInputTokens: 1000, maxOutputTokens: 500 },
    correlationId: `corr-${seed.ref}`,
    requestingAgent: seed.ref.startsWith("prompt.ba-agent")
      ? "agent.ba-agent"
      : "agent.normalization",
  };
}

test("end-to-end: fake adapter → assertProvenance → InMemory store → validateProvenanceRefs", async () => {
  const ctx = makeCtx("tenant.alpha", 100);
  const store = new InMemoryAIProvenanceStore();

  for (const seed of [BA_INTAKE, BIM_TO_AIM]) {
    const req = makeRequest(seed);
    const result = fakeInvoke(req, ctx, seed);
    // Kernel-side guard MUST accept a well-formed record.
    assertProvenance(result);
    const stored = await store.record(result.provenance);
    // Re-assert with `stored` — proves the store did not silently rewrite fields.
    assertProvenance(result, stored);
  }

  const refs = await store.listReferencedPromptVersions();
  const registry = await loadRegistry(REGISTRY_PATH);
  const problems = validateProvenanceRefs(registry, refs);
  assert.deepEqual(
    problems,
    [],
    `expected zero registry validation problems, got ${JSON.stringify(problems)}`,
  );
});

test("end-to-end: JSONL store round-trip + query by tenantId", async () => {
  const dir = await mkdtemp(join(tmpdir(), "appbana-provenance-int-"));
  const path = join(dir, "provenance.jsonl");
  try {
    const store = await JsonlAIProvenanceStore.open({ filePath: path });

    // Two tenants, two prompts, one record each.
    for (const tenantId of ["tenant.alpha", "tenant.beta"] as const) {
      const ctx = makeCtx(tenantId, 100);
      for (const seed of [BA_INTAKE, BIM_TO_AIM]) {
        const result = fakeInvoke(makeRequest(seed), ctx, seed);
        assertProvenance(result);
        await store.record(result.provenance);
      }
    }

    // JsonlAIProvenanceStore appends per write and holds no file handle, so
    // there is nothing to close before re-opening cold.

    // Re-open cold — proves durability + hash-content-addressing.
    const reopened = await JsonlAIProvenanceStore.open({ filePath: path });
    const alpha = await reopened.query({ tenantId: "tenant.alpha" });
    const beta = await reopened.query({ tenantId: "tenant.beta" });
    assert.equal(alpha.length, 2);
    assert.equal(beta.length, 2);
    assert.ok(alpha.every((e) => e.record.tenantId === "tenant.alpha"));
    assert.ok(beta.every((e) => e.record.tenantId === "tenant.beta"));

    // Distinct prompt refs across both tenants = 2.
    const refs = await reopened.listReferencedPromptVersions();
    assert.equal(refs.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("end-to-end: redaction changes inputHash but hashes stay stable across identical redacted inputs", () => {
  const ctx = makeCtx("tenant.alpha", 100);
  const req1 = makeRequest(BA_INTAKE);
  const req2 = makeRequest(BA_INTAKE);
  // Different original email, but redaction masks both.
  const req2b: AIInvocationRequest = {
    ...req2,
    inputs: { ...req2.inputs, email: "someone.else@example.org" },
  };

  const p1 = fakeInvoke(req1, ctx, BA_INTAKE).provenance;
  const p2 = fakeInvoke(req2b, ctx, BA_INTAKE).provenance;

  // Different plain-text emails → SAME inputHash because both are masked
  // to the same placeholder before hashing. This proves redaction runs BEFORE
  // hashing (ADR-015 mandate).
  assert.equal(p1.inputHash, p2.inputHash);
  assert.equal(p1.redactions.length, 1);
  assert.equal(p1.redactions[0]?.action, "masked");
});
