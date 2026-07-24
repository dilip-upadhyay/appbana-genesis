import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { JsonlAIProvenanceStore, recordId } from "../dist/index.js";

import { makeRecord } from "./fixtures.ts";

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "aips-jsonl-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("JsonlAIProvenanceStore persists across reopens", async () => {
  await withTmp(async (dir) => {
    const file = join(dir, "provenance.jsonl");
    const first = await JsonlAIProvenanceStore.open({ filePath: file });
    const stored = await first.record(makeRecord());

    const second = await JsonlAIProvenanceStore.open({ filePath: file });
    const fetched = await second.get(stored.id);
    assert.ok(fetched);
    assert.equal(fetched!.id, stored.id);
    assert.deepEqual(fetched!.record, stored.record);
  });
});

test("JsonlAIProvenanceStore appends one line per record", async () => {
  await withTmp(async (dir) => {
    const file = join(dir, "p.jsonl");
    const store = await JsonlAIProvenanceStore.open({ filePath: file });
    await store.record(makeRecord());
    await store.record(
      makeRecord({ inputHash: "sha256:" + "9".repeat(64) }),
    );
    const contents = await readFile(file, "utf8");
    const lines = contents.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  });
});

test("JsonlAIProvenanceStore is idempotent — same record does not double-append", async () => {
  await withTmp(async (dir) => {
    const file = join(dir, "p.jsonl");
    const store = await JsonlAIProvenanceStore.open({ filePath: file });
    await store.record(makeRecord());
    await store.record(makeRecord());
    const contents = await readFile(file, "utf8");
    const lines = contents.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 1);
    assert.equal(await store.count(), 1);
  });
});

test("open() reports a warning for a malformed trailing line and continues", async () => {
  await withTmp(async (dir) => {
    const file = join(dir, "p.jsonl");
    // Seed with one valid line + one garbage line.
    const good = {
      id: recordId(makeRecord()),
      insertedAt: "2026-07-24T00:00:00.000Z",
      record: makeRecord(),
    };
    await writeFile(
      file,
      `${JSON.stringify(good)}\n{not json\n`,
      "utf8",
    );
    const store = await JsonlAIProvenanceStore.open({ filePath: file });
    const warnings = store.loadWarnings();
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.line, 2);
    assert.equal(await store.count(), 1);
  });
});

test("open() drops an entry whose id disagrees with its record", async () => {
  await withTmp(async (dir) => {
    const file = join(dir, "p.jsonl");
    const tampered = {
      id: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      insertedAt: "2026-07-24T00:00:00.000Z",
      record: makeRecord(),
    };
    await writeFile(file, `${JSON.stringify(tampered)}\n`, "utf8");
    const store = await JsonlAIProvenanceStore.open({ filePath: file });
    const warnings = store.loadWarnings();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!.reason, /id mismatch/);
    assert.equal(await store.count(), 0);
  });
});

test("open() on missing file yields an empty store", async () => {
  await withTmp(async (dir) => {
    const file = join(dir, "does-not-exist.jsonl");
    const store = await JsonlAIProvenanceStore.open({ filePath: file });
    assert.equal(await store.count(), 0);
    assert.equal(store.loadWarnings().length, 0);
  });
});

test("listReferencedPromptVersions works after a round-trip through disk", async () => {
  await withTmp(async (dir) => {
    const file = join(dir, "p.jsonl");
    const first = await JsonlAIProvenanceStore.open({ filePath: file });
    await first.record(makeRecord());
    await first.record(
      makeRecord({
        promptTemplateRef: "prompt.normalization-agent.bim-to-aim",
        inputHash: "sha256:" + "a".repeat(64),
      }),
    );

    const second = await JsonlAIProvenanceStore.open({ filePath: file });
    const refs = await second.listReferencedPromptVersions();
    assert.equal(refs.length, 2);
  });
});
