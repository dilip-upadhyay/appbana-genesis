/**
 * Runs the shared `@appbana/ai-adapter-conformance-suite` against the Claude
 * text-generation adapter using the deterministic fake client. Passing this
 * suite is the sole path to certifying a real adapter.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { runConformance } from "@appbana/ai-adapter-conformance-suite";

import { createClaudeTextGenerationAdapter } from "../dist/index.js";

import { createFakeAnthropicClient } from "./fake-client.ts";

test("Claude text-generation adapter passes Tier B conformance", async () => {
  const fake = createFakeAnthropicClient({ responseText: "hello" });
  const adapter = createClaudeTextGenerationAdapter({
    apiKey: "sk-test",
    clientFactory: async () => fake,
  });

  const report = await runConformance(adapter, {
    tier: "B",
    config: {},
  });

  assert.equal(report.tier, "B");
  assert.equal(
    report.passed,
    true,
    formatFailures(report.checks),
  );
  assert.equal(report.adapterBinding, "ai:anthropic-claude");
  assert.equal(report.adapterVersion, "0.1.0");
});

function formatFailures(
  checks: readonly {
    readonly id: string;
    readonly title: string;
    readonly passed: boolean;
    readonly skipped?: boolean;
    readonly reason?: string;
  }[],
): string {
  const failed = checks
    .filter((c) => !c.passed && c.skipped !== true)
    .map((c) => `  ${c.id} ${c.title}: ${c.reason ?? "(no reason)"}`);
  return failed.length === 0 ? "" : `\n${failed.join("\n")}`;
}
