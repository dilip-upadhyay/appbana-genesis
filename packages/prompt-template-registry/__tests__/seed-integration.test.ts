/**
 * Integration test — loads the real shipped `./prompts` directory and asserts
 * the seed manifest is consistent with the seed files. This is the same check
 * `prompt-registry-check` runs in CI; catching it here fails fast on any
 * accidental drift.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadRegistry, renderPrompt } from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS_ROOT = resolve(HERE, "..", "prompts");

test("shipped registry loads without problems", async () => {
  const registry = await loadRegistry(PROMPTS_ROOT);
  assert.ok(registry.templates.size >= 2, "expected at least 2 seed prompts");
  assert.ok(registry.templates.has("prompt.ba-agent.intake@1.0.0"));
  assert.ok(
    registry.templates.has("prompt.normalization-agent.bim-to-aim@1.0.0"),
  );
});

test("shipped BA-intake prompt renders with expected variables", async () => {
  const registry = await loadRegistry(PROMPTS_ROOT);
  const rendered = renderPrompt(registry, {
    ref: "prompt.ba-agent.intake",
    version: "1.0.0",
    variables: {
      tenantName: "Acme Bank",
      processDescription: "customer onboarding",
    },
  });
  assert.match(rendered.text, /Acme Bank/);
  assert.match(rendered.text, /customer onboarding/);
  assert.match(rendered.hash, /^sha256:[0-9a-f]{64}$/);
  assert.match(rendered.templateHash, /^sha256:[0-9a-f]{64}$/);
});

test("shipped BIM-to-AIM prompt renders with expected variables", async () => {
  const registry = await loadRegistry(PROMPTS_ROOT);
  const rendered = renderPrompt(registry, {
    ref: "prompt.normalization-agent.bim-to-aim",
    version: "1.0.0",
    variables: {
      tenantName: "Acme Bank",
      bimJson: JSON.stringify({ appId: "customer-onboarding" }),
    },
  });
  assert.match(rendered.text, /Acme Bank/);
  assert.match(rendered.text, /customer-onboarding/);
});
