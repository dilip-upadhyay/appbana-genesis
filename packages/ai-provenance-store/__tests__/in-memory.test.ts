import { strict as assert } from "node:assert";
import { test } from "node:test";

import { InMemoryAIProvenanceStore } from "../dist/index.js";

import { makeRecord } from "./fixtures.ts";

test("record + get roundtrip", async () => {
  const store = new InMemoryAIProvenanceStore();
  const record = makeRecord();
  const stored = await store.record(record);
  const fetched = await store.get(stored.id);
  assert.deepEqual(fetched?.record, record);
});

test("record is idempotent on identical input", async () => {
  const store = new InMemoryAIProvenanceStore();
  const a = await store.record(makeRecord());
  const b = await store.record(makeRecord());
  assert.equal(a.id, b.id);
  assert.equal(await store.count(), 1);
});

test("query filters by requestingAgent and modelBinding", async () => {
  const store = new InMemoryAIProvenanceStore();
  await store.record(
    makeRecord({ requestingAgent: "agent.ba-agent", modelBinding: "ai:anthropic-claude" }),
  );
  await store.record(
    makeRecord({
      requestingAgent: "agent.normalization",
      modelBinding: "ai:anthropic-claude",
      inputHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    }),
  );
  await store.record(
    makeRecord({
      requestingAgent: "agent.ba-agent",
      modelBinding: "ai:local-llama",
      inputHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    }),
  );

  const byAgent = await store.query({ requestingAgent: "agent.ba-agent" });
  assert.equal(byAgent.length, 2);

  const byModel = await store.query({ modelBinding: "ai:anthropic-claude" });
  assert.equal(byModel.length, 2);

  const both = await store.query({
    requestingAgent: "agent.ba-agent",
    modelBinding: "ai:anthropic-claude",
  });
  assert.equal(both.length, 1);
});

test("query is ordered oldest first and respects limit", async () => {
  let t = 0;
  const store = new InMemoryAIProvenanceStore({
    now: () => new Date(2026, 0, 1, 0, 0, ++t),
  });
  await store.record(makeRecord({ inputHash: "sha256:11" + "1".repeat(62) }));
  await store.record(makeRecord({ inputHash: "sha256:22" + "2".repeat(62) }));
  await store.record(makeRecord({ inputHash: "sha256:33" + "3".repeat(62) }));

  const all = await store.query();
  assert.equal(all.length, 3);
  assert.ok(all[0]!.insertedAt < all[1]!.insertedAt);
  assert.ok(all[1]!.insertedAt < all[2]!.insertedAt);

  const limited = await store.query({ limit: 2 });
  assert.equal(limited.length, 2);
});

test("query filters by since / until", async () => {
  let t = 0;
  const store = new InMemoryAIProvenanceStore({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++t)),
  });
  await store.record(makeRecord({ inputHash: "sha256:a" + "0".repeat(63) }));
  await store.record(makeRecord({ inputHash: "sha256:b" + "0".repeat(63) }));
  await store.record(makeRecord({ inputHash: "sha256:c" + "0".repeat(63) }));

  const after = await store.query({ since: "2026-01-01T00:00:02.000Z" });
  assert.equal(after.length, 2);

  const before = await store.query({ until: "2026-01-01T00:00:02.000Z" });
  assert.equal(before.length, 2);
});

test("count matches query length", async () => {
  const store = new InMemoryAIProvenanceStore();
  await store.record(makeRecord());
  await store.record(
    makeRecord({ inputHash: "sha256:" + "9".repeat(64) }),
  );
  const filter = { requestingAgent: "agent.ba-agent" };
  const q = await store.query(filter);
  const n = await store.count(filter);
  assert.equal(n, q.length);
});

test("listReferencedPromptVersions dedupes distinct triples", async () => {
  const store = new InMemoryAIProvenanceStore();
  await store.record(makeRecord());
  // Same ref + version + hash — should dedupe with the first.
  await store.record(
    makeRecord({
      inputHash: "sha256:" + "1".repeat(64),
    }),
  );
  // Different version — new row.
  await store.record(
    makeRecord({
      promptTemplateVersion: "1.1.0",
      inputHash: "sha256:" + "2".repeat(64),
    }),
  );
  // Different ref — new row.
  await store.record(
    makeRecord({
      promptTemplateRef: "prompt.normalization-agent.bim-to-aim",
      inputHash: "sha256:" + "3".repeat(64),
    }),
  );
  const refs = await store.listReferencedPromptVersions();
  assert.equal(refs.length, 3);
  const keys = refs.map((r) => `${r.ref}@${r.version}`);
  assert.ok(keys.includes("prompt.ba-agent.intake@1.0.0"));
  assert.ok(keys.includes("prompt.ba-agent.intake@1.1.0"));
  assert.ok(keys.includes("prompt.normalization-agent.bim-to-aim@1.0.0"));
  for (const r of refs) {
    assert.match(r.templateHash!, /^sha256:[0-9a-f]{64}$/);
  }
});
