import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  RenderError,
  loadRegistry,
  promptTemplateHash,
  renderPrompt,
  renderedPromptHash,
  resolveTemplate,
} from "../dist/index.js";

async function makeRegistry(body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ptr-render-"));
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

test("renderPrompt substitutes single-word variables", async () => {
  const root = await makeRegistry("Hello {{name}}!\n");
  try {
    const registry = await loadRegistry(root);
    const rendered = renderPrompt(registry, {
      ref: "prompt.test-agent.smoke",
      version: "1.0.0",
      variables: { name: "Ada" },
    });
    assert.equal(rendered.text, "Hello Ada!\n");
    assert.equal(rendered.hash, renderedPromptHash("Hello Ada!\n"));
    assert.equal(rendered.templateHash, promptTemplateHash("Hello {{name}}!\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renderPrompt tolerates whitespace inside placeholders", async () => {
  const root = await makeRegistry("Hi {{  who  }}");
  try {
    const registry = await loadRegistry(root);
    const rendered = renderPrompt(registry, {
      ref: "prompt.test-agent.smoke",
      version: "1.0.0",
      variables: { who: "Grace" },
    });
    assert.equal(rendered.text, "Hi Grace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renderPrompt coerces number and boolean values to string", async () => {
  const root = await makeRegistry("count={{n}} flag={{ok}}");
  try {
    const registry = await loadRegistry(root);
    const rendered = renderPrompt(registry, {
      ref: "prompt.test-agent.smoke",
      version: "1.0.0",
      variables: { n: 7, ok: true },
    });
    assert.equal(rendered.text, "count=7 flag=true");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renderPrompt throws when a referenced variable is missing", async () => {
  const root = await makeRegistry("Hello {{name}} from {{tenant}}");
  try {
    const registry = await loadRegistry(root);
    assert.throws(
      () =>
        renderPrompt(registry, {
          ref: "prompt.test-agent.smoke",
          version: "1.0.0",
          variables: { name: "Ada" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof RenderError);
        assert.deepEqual(err.missingVariables, ["tenant"]);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renderPrompt throws on unused variables in strict mode", async () => {
  const root = await makeRegistry("Hello {{name}}");
  try {
    const registry = await loadRegistry(root);
    assert.throws(
      () =>
        renderPrompt(registry, {
          ref: "prompt.test-agent.smoke",
          version: "1.0.0",
          variables: { name: "Ada", extra: "surprise" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof RenderError);
        assert.deepEqual(err.unusedVariables, ["extra"]);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renderPrompt accepts extra variables when strictUnused=false", async () => {
  const root = await makeRegistry("Hello {{name}}");
  try {
    const registry = await loadRegistry(root);
    const rendered = renderPrompt(
      registry,
      {
        ref: "prompt.test-agent.smoke",
        version: "1.0.0",
        variables: { name: "Ada", extra: "surprise" },
      },
      { strictUnused: false },
    );
    assert.equal(rendered.text, "Hello Ada");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveTemplate throws on unknown (ref, version)", async () => {
  const root = await makeRegistry("hi");
  try {
    const registry = await loadRegistry(root);
    assert.throws(() =>
      resolveTemplate(registry, "prompt.test-agent.smoke", "9.9.9"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
