import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  loadRegistry,
  promptTemplateHash,
  validateProvenanceRefs,
  validateRegistry,
} from "../dist/index.js";

async function makeRegistry(body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ptr-validate-"));
  await mkdir(join(root, "test-agent"), { recursive: true });
  await writeFile(
    join(root, "test-agent", "smoke.1.0.0.prompt.md"),
    body,
    "utf8",
  );
  const index = {
    registryVersion: "0.1",
    templates: [
      {
        ref: "prompt.test-agent.smoke",
        version: "1.0.0",
        agent: "test-agent",
        task: "smoke",
        file: "test-agent/smoke.1.0.0.prompt.md",
        sha256: promptTemplateHash(body),
        status: "active",
        createdAt: "2026-07-24",
      },
    ],
  };
  await writeFile(join(root, "index.json"), JSON.stringify(index), "utf8");
  return root;
}

test("validateRegistry returns no problems for a clean registry", async () => {
  const root = await makeRegistry("hi");
  try {
    const registry = await loadRegistry(root);
    assert.deepEqual(validateRegistry(registry), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validateProvenanceRefs passes when every ref resolves", async () => {
  const body = "hi";
  const root = await makeRegistry(body);
  try {
    const registry = await loadRegistry(root);
    const problems = validateProvenanceRefs(registry, [
      {
        ref: "prompt.test-agent.smoke",
        version: "1.0.0",
        templateHash: promptTemplateHash(body),
      },
    ]);
    assert.deepEqual(problems, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validateProvenanceRefs emits PROVENANCE_REF_MISSING for deleted templates", async () => {
  const root = await makeRegistry("hi");
  try {
    const registry = await loadRegistry(root);
    const problems = validateProvenanceRefs(registry, [
      { ref: "prompt.test-agent.smoke", version: "9.9.9" },
      { ref: "prompt.missing-agent.gone", version: "1.0.0" },
    ]);
    assert.equal(problems.length, 2);
    assert.ok(problems.every((p) => p.code === "PROVENANCE_REF_MISSING"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validateProvenanceRefs emits PROVENANCE_HASH_MISMATCH for mutated templates", async () => {
  const root = await makeRegistry("hi");
  try {
    const registry = await loadRegistry(root);
    const problems = validateProvenanceRefs(registry, [
      {
        ref: "prompt.test-agent.smoke",
        version: "1.0.0",
        templateHash: "sha256:deadbeef",
      },
    ]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0]?.code, "PROVENANCE_HASH_MISMATCH");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validateProvenanceRefs skips hash check when templateHash is omitted", async () => {
  const root = await makeRegistry("hi");
  try {
    const registry = await loadRegistry(root);
    const problems = validateProvenanceRefs(registry, [
      { ref: "prompt.test-agent.smoke", version: "1.0.0" },
    ]);
    assert.deepEqual(problems, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
