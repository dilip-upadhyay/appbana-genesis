/**
 * Runs the shared conformance suite against the Llama text-generation adapter
 * at Tier A (the strictest tier — checks air-gapped invariant, determinism,
 * data residency, and redaction).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { runConformance } from "@appbana/ai-adapter-conformance-suite";

import { createLocalLlamaTextGenerationAdapter } from "../dist/index.js";

import { createFakeLocalLlamaClient } from "./fake-client.ts";

test("Llama text-generation adapter passes Tier A conformance", async () => {
  const fake = createFakeLocalLlamaClient({ responseText: "hello" });
  const adapter = createLocalLlamaTextGenerationAdapter({
    clientFactory: async () => fake,
  });

  const report = await runConformance(adapter, {
    tier: "A",
    config: {},
    initContext: { deploymentMode: "air-gapped" },
    fixtures: {
      redactionRequest: {
        promptTemplateRef: "prompt.conformance.redaction",
        promptTemplateVersion: "1.0.0",
        inputs: { note: "SSN is 123-45-6789 for testing" },
        responseContract: { kind: "free-text" },
        budget: {},
        correlationId: "00000000-0000-4000-8000-0000000000cc",
        requestingAgent: "agent.conformance",
      },
      expectedRedactionPaths: ["/inputs/note"],
    },
  });

  assert.equal(report.tier, "A");
  assert.equal(report.adapterBinding, "ai:local-llama");
  assert.equal(
    report.passed,
    true,
    formatFailures(report.checks),
  );
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
