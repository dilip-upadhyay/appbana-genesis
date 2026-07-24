import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  RegistryError,
  loadRegistry,
  promptTemplateHash,
  tryLoadRegistry,
} from "../dist/index.js";

/** Create a scratch registry root with fully-consistent hashes. */
async function makeScratchRegistry(
  entries: readonly {
    ref: string;
    version: string;
    agent: string;
    task: string;
    body: string;
    overrideHash?: string;
    file?: string;
  }[],
  indexOverrides: Record<string, unknown> = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ptr-load-"));
  const templates = [];
  for (const e of entries) {
    const file = e.file ?? `${e.agent}/${e.task}.${e.version}.prompt.md`;
    await mkdir(join(root, e.agent), { recursive: true });
    await writeFile(join(root, file), e.body, "utf8");
    templates.push({
      ref: e.ref,
      version: e.version,
      agent: e.agent,
      task: e.task,
      file,
      sha256: e.overrideHash ?? promptTemplateHash(e.body),
      status: "active",
      createdAt: "2026-07-24",
    });
  }
  const index = {
    registryVersion: "0.1",
    templates,
    ...indexOverrides,
  };
  await writeFile(
    join(root, "index.json"),
    JSON.stringify(index, null, 2),
    "utf8",
  );
  return root;
}

test("loadRegistry accepts a well-formed registry", async () => {
  const root = await makeScratchRegistry([
    {
      ref: "prompt.test-agent.smoke",
      version: "1.0.0",
      agent: "test-agent",
      task: "smoke",
      body: "hello {{name}}\n",
    },
  ]);
  try {
    const registry = await loadRegistry(root);
    assert.equal(registry.templates.size, 1);
    const t = registry.templates.get("prompt.test-agent.smoke@1.0.0");
    assert.ok(t);
    assert.equal(t!.agent, "test-agent");
    assert.equal(t!.body, "hello {{name}}\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("HASH_MISMATCH surfaces when declared sha256 does not match on-disk body", async () => {
  const root = await makeScratchRegistry([
    {
      ref: "prompt.test-agent.smoke",
      version: "1.0.0",
      agent: "test-agent",
      task: "smoke",
      body: "hello",
      overrideHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  ]);
  try {
    await assert.rejects(loadRegistry(root), RegistryError);
    const result = await tryLoadRegistry(root);
    assert.equal(result.kind, "error");
    if (result.kind === "error") {
      assert.equal(result.problems[0]?.code, "HASH_MISMATCH");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("FILE_MISSING when a template body is absent", async () => {
  const root = await makeScratchRegistry([]);
  const index = {
    registryVersion: "0.1",
    templates: [
      {
        ref: "prompt.test-agent.gone",
        version: "1.0.0",
        agent: "test-agent",
        task: "gone",
        file: "test-agent/gone.1.0.0.prompt.md",
        sha256: "sha256:deadbeef",
        status: "active",
        createdAt: "2026-07-24",
      },
    ],
  };
  await writeFile(
    join(root, "index.json"),
    JSON.stringify(index),
    "utf8",
  );
  try {
    const result = await tryLoadRegistry(root);
    assert.equal(result.kind, "error");
    if (result.kind === "error") {
      assert.equal(result.problems[0]?.code, "FILE_MISSING");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DUPLICATE_ENTRY when the same (ref, version) appears twice", async () => {
  const root = await makeScratchRegistry([
    {
      ref: "prompt.test-agent.smoke",
      version: "1.0.0",
      agent: "test-agent",
      task: "smoke",
      body: "hi",
    },
    {
      ref: "prompt.test-agent.smoke",
      version: "1.0.0",
      agent: "test-agent",
      task: "smoke",
      body: "hi",
      file: "test-agent/smoke.1.0.0.prompt.md",
    },
  ]);
  try {
    const result = await tryLoadRegistry(root);
    assert.equal(result.kind, "error");
    if (result.kind === "error") {
      assert.ok(
        result.problems.some((p) => p.code === "DUPLICATE_ENTRY"),
        "expected DUPLICATE_ENTRY problem",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("REF_MALFORMED when ref does not match prompt.<agent>.<task>", async () => {
  const root = await makeScratchRegistry([
    {
      ref: "prompt.INVALID.smoke",
      version: "1.0.0",
      agent: "INVALID",
      task: "smoke",
      body: "x",
    },
  ]);
  try {
    const result = await tryLoadRegistry(root);
    assert.equal(result.kind, "error");
    if (result.kind === "error") {
      assert.ok(
        result.problems.some((p) => p.code === "REF_MALFORMED"),
        `expected REF_MALFORMED, got ${result.problems.map((p) => p.code).join(",")}`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("VERSION_MALFORMED when version is not semver", async () => {
  const root = await makeScratchRegistry([
    {
      ref: "prompt.test-agent.smoke",
      version: "1.0",
      agent: "test-agent",
      task: "smoke",
      body: "x",
    },
  ]);
  try {
    const result = await tryLoadRegistry(root);
    assert.equal(result.kind, "error");
    if (result.kind === "error") {
      assert.ok(
        result.problems.some((p) => p.code === "VERSION_MALFORMED"),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("INDEX_MALFORMED when registryVersion is wrong", async () => {
  const root = await makeScratchRegistry([], {
    registryVersion: "0.9",
  });
  try {
    const result = await tryLoadRegistry(root);
    assert.equal(result.kind, "error");
    if (result.kind === "error") {
      assert.equal(result.problems[0]?.code, "INDEX_MALFORMED");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
