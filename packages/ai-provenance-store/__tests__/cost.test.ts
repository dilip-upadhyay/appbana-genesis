/**
 * Cost aggregator tests — validated against an InMemoryAIProvenanceStore
 * populated with a deterministic mix of tenants, bindings, and days.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { AIProvenanceRecord } from "@appbana/adapter-ai-contract";

import {
  aggregateCostByTenantAndDay,
  getBudgetRemaining,
  InMemoryAIProvenanceStore,
  type CostCatalog,
} from "../dist/index.js";

import { makeRecord } from "./fixtures.ts";

const CATALOG: CostCatalog = new Map([
  ["ai:anthropic-claude", { costPerInputToken: 0.000003, costPerOutputToken: 0.000015 }],
  ["ai:openai-gpt4o", { costPerInputToken: 0.0000025, costPerOutputToken: 0.00001 }],
  // ai:local-llama intentionally absent → contributes $0.
]);

function rec(overrides: Partial<AIProvenanceRecord>): AIProvenanceRecord {
  return makeRecord(overrides);
}

async function seed(): Promise<InMemoryAIProvenanceStore> {
  // Deterministic clock so InsertedAt ordering is stable.
  let tick = 0;
  const store = new InMemoryAIProvenanceStore({
    now: () => new Date(Date.UTC(2026, 7, 5, 10, 0, tick++)),
  });

  // tenant.alpha, claude, 2026-07-24  (2 calls, distinct hashes)
  await store.record(rec({
    tenantId: "tenant.alpha",
    modelBinding: "ai:anthropic-claude",
    completedAt: "2026-07-24T12:00:00.000Z",
    tokenUsage: { input: 1000, output: 500, total: 1500 },
    inputHash: `sha256:${"a".repeat(64)}`,
  }));
  await store.record(rec({
    tenantId: "tenant.alpha",
    modelBinding: "ai:anthropic-claude",
    completedAt: "2026-07-24T18:00:00.000Z",
    tokenUsage: { input: 500, output: 250, total: 750 },
    inputHash: `sha256:${"b".repeat(64)}`,
  }));

  // tenant.alpha, gpt4o, 2026-07-24 (1 call)
  await store.record(rec({
    tenantId: "tenant.alpha",
    modelBinding: "ai:openai-gpt4o",
    completedAt: "2026-07-24T15:00:00.000Z",
    tokenUsage: { input: 2000, output: 1000, total: 3000 },
    inputHash: `sha256:${"c".repeat(64)}`,
  }));

  // tenant.alpha, claude, 2026-07-25 (1 call)
  await store.record(rec({
    tenantId: "tenant.alpha",
    modelBinding: "ai:anthropic-claude",
    completedAt: "2026-07-25T09:00:00.000Z",
    tokenUsage: { input: 100, output: 50, total: 150 },
    inputHash: `sha256:${"d".repeat(64)}`,
  }));

  // tenant.beta, claude, 2026-07-24 (1 call)
  await store.record(rec({
    tenantId: "tenant.beta",
    modelBinding: "ai:anthropic-claude",
    completedAt: "2026-07-24T11:00:00.000Z",
    tokenUsage: { input: 400, output: 100, total: 500 },
    inputHash: `sha256:${"e".repeat(64)}`,
  }));

  // tenant.beta, local-llama (no cost fields → contributes $0 to spend)
  await store.record(rec({
    tenantId: "tenant.beta",
    modelBinding: "ai:local-llama",
    completedAt: "2026-07-24T14:00:00.000Z",
    tokenUsage: { input: 9999, output: 9999, total: 19998 },
    inputHash: `sha256:${"f".repeat(64)}`,
  }));

  return store;
}

test("cost: aggregate produces one row per (tenant, binding, day)", async () => {
  const store = await seed();
  const rows = await aggregateCostByTenantAndDay(store, { catalog: CATALOG });
  assert.equal(rows.length, 5); // alpha/claude/24, alpha/gpt4o/24, alpha/claude/25, beta/claude/24, beta/local-llama/24

  // Alpha/Claude/2026-07-24 = (1000+500) * 0.000003 + (500+250) * 0.000015
  const alphaClaude24 = rows.find(
    (r) => r.tenantId === "tenant.alpha"
      && r.modelBinding === "ai:anthropic-claude"
      && r.day === "2026-07-24",
  );
  assert.ok(alphaClaude24, "expected alpha/claude/2026-07-24 row");
  assert.equal(alphaClaude24!.calls, 2);
  assert.equal(alphaClaude24!.inputTokens, 1500);
  assert.equal(alphaClaude24!.outputTokens, 750);
  assert.equal(alphaClaude24!.totalTokens, 2250);
  const expectedAlphaClaude24 = 1500 * 0.000003 + 750 * 0.000015;
  assert.equal(alphaClaude24!.estimatedUsd, expectedAlphaClaude24);

  // Beta/local-llama contributes 0 spend even though it burned tokens.
  const betaLlama = rows.find((r) => r.modelBinding === "ai:local-llama");
  assert.ok(betaLlama);
  assert.equal(betaLlama!.estimatedUsd, 0);
});

test("cost: since/until filter narrows the day window", async () => {
  const store = await seed();
  const only25 = await aggregateCostByTenantAndDay(store, {
    since: "2026-07-25T00:00:00.000Z",
    until: "2026-07-25T23:59:59.999Z",
    catalog: CATALOG,
  });
  assert.equal(only25.length, 1);
  assert.equal(only25[0]!.day, "2026-07-25");
});

test("cost: tenantId filter narrows to one tenant", async () => {
  const store = await seed();
  const alphaOnly = await aggregateCostByTenantAndDay(store, {
    tenantId: "tenant.alpha",
    catalog: CATALOG,
  });
  assert.ok(alphaOnly.every((r) => r.tenantId === "tenant.alpha"));
  assert.equal(alphaOnly.length, 3); // alpha × (claude/24, gpt4o/24, claude/25)
});

test("cost: getBudgetRemaining computes spend vs budget for a single tenant-day", async () => {
  const store = await seed();
  // Alpha spent on 2026-07-24 across two bindings.
  const status = await getBudgetRemaining(
    store,
    /* budgetUsd */ 1.0,
    "tenant.alpha",
    "2026-07-24",
    CATALOG,
  );
  const expectedClaude = 1500 * 0.000003 + 750 * 0.000015;
  const expectedGpt = 2000 * 0.0000025 + 1000 * 0.00001;
  const expectedSpend = expectedClaude + expectedGpt;
  assert.equal(status.tenantId, "tenant.alpha");
  assert.equal(status.day, "2026-07-24");
  assert.equal(status.budgetUsd, 1.0);
  assert.equal(status.spentUsd, expectedSpend);
  assert.equal(status.remainingUsd, 1.0 - expectedSpend);
  assert.equal(status.exceeded, false);
});

test("cost: getBudgetRemaining flags exceeded when spend > budget", async () => {
  const store = await seed();
  const status = await getBudgetRemaining(
    store,
    /* budgetUsd */ 0.000001,
    "tenant.alpha",
    "2026-07-24",
    CATALOG,
  );
  assert.equal(status.exceeded, true);
  assert.ok(status.remainingUsd < 0);
});
