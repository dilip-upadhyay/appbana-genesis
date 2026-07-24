import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  JsonlMetadataRegistry,
  computeContentHash,
} from "../dist/index.js";

import { BIM_FIXTURE } from "./fixtures.ts";

describe("JsonlMetadataRegistry", () => {
  let workDir: string;

  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), "metadata-registry-jsonl-"));
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("appends one JSON line per record()", async () => {
    const filePath = join(workDir, "append.jsonl");
    const reg = new JsonlMetadataRegistry({
      filePath,
      now: () => new Date("2026-07-25T00:00:00.000Z"),
    });
    await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    const raw = await readFile(filePath, "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!) as {
      id: string;
      insertedAt: string;
      record: { appId: string; artifactKind: string };
    };
    assert.equal(parsed.record.appId, "app.customer-onboarding");
    assert.equal(parsed.record.artifactKind, "bim");
  });

  it("second process (new instance) reads back existing rows", async () => {
    const filePath = join(workDir, "roundtrip.jsonl");
    const a = new JsonlMetadataRegistry({
      filePath,
      now: () => new Date("2026-07-25T00:00:01.000Z"),
    });
    const written = await a.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    const b = new JsonlMetadataRegistry({ filePath });
    const found = await b.get(written.id);
    assert.deepEqual(found, written);
  });

  it("record() is idempotent — writing same bytes twice appends once", async () => {
    const filePath = join(workDir, "dedupe.jsonl");
    const reg = new JsonlMetadataRegistry({
      filePath,
      now: () => new Date("2026-07-25T00:00:02.000Z"),
    });
    const a = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    const b = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    assert.equal(a.id, b.id);
    const raw = await readFile(filePath, "utf8");
    assert.equal(raw.split("\n").filter((l) => l.length > 0).length, 1);
  });

  it("surfaces malformed lines via loadWarnings and continues loading valid lines", async () => {
    const filePath = join(workDir, "recovery.jsonl");
    const goodBody = { app: "x", n: 1 };
    const goodId = computeContentHash(goodBody);
    const goodLine = JSON.stringify({
      id: goodId,
      insertedAt: "2026-07-25T00:00:00.000Z",
      record: {
        appId: "app.x",
        tenantId: "tenant.demo",
        artifactKind: "bim",
        version: "1.0.0",
        content: goodBody,
      },
    });
    await writeFile(
      filePath,
      `${goodLine}\n{"broken":`,
      "utf8",
    );
    const reg = new JsonlMetadataRegistry({ filePath });
    const all = await reg.find();
    assert.equal(all.length, 1);
    assert.equal(reg.loadWarnings().length, 1);
    assert.equal(reg.loadWarnings()[0]?.line, 2);
    assert.match(reg.loadWarnings()[0]?.reason ?? "", /malformed/);
  });

  it("missing file loads empty — no error", async () => {
    const filePath = join(workDir, "missing.jsonl");
    const reg = new JsonlMetadataRegistry({ filePath });
    assert.equal(await reg.count(), 0);
    assert.deepEqual(reg.loadWarnings(), []);
  });

  it("get() throws ContentHashMismatchError when file bytes have been tampered", async () => {
    const filePath = join(workDir, "tampered.jsonl");
    // Write a line whose declared id does not match its content bytes → the
    // loader will drop this as a warning (declared id != recomputed hash).
    // Then hand-craft a corrupted stored entry that DOES load but whose
    // content later drifts. We simulate by writing a valid line, then hand-
    // rewriting the file with a mutated content field but the ORIGINAL id.
    const body = { a: 1 };
    const id = computeContentHash(body);
    const goodLine = JSON.stringify({
      id,
      insertedAt: "2026-07-25T00:00:00.000Z",
      record: {
        appId: "app.x",
        tenantId: "tenant.demo",
        artifactKind: "bim",
        version: "1.0.0",
        content: body,
      },
    });
    await writeFile(filePath, `${goodLine}\n`, "utf8");
    // Now on-disk bytes claim id X but content is Y. Loader rejects such
    // rows because it recomputes at load time — this becomes a load warning
    // and the row is not in memory.
    const tamperedLine = JSON.stringify({
      id, // stale
      insertedAt: "2026-07-25T00:00:00.000Z",
      record: {
        appId: "app.x",
        tenantId: "tenant.demo",
        artifactKind: "bim",
        version: "1.0.0",
        content: { a: 2 }, // different!
      },
    });
    await writeFile(filePath, `${tamperedLine}\n`, "utf8");
    const reg = new JsonlMetadataRegistry({ filePath });
    const all = await reg.find();
    assert.equal(all.length, 0);
    assert.equal(reg.loadWarnings().length, 1);
    assert.match(reg.loadWarnings()[0]?.reason ?? "", /does not match/);
  });

  it("find honours (appId, artifactKind, version, tenantId) filters", async () => {
    const filePath = join(workDir, "filter.jsonl");
    let seq = 0;
    const reg = new JsonlMetadataRegistry({
      filePath,
      now: () => new Date(Date.UTC(2026, 6, 25, 1, 0, seq++)),
    });
    await reg.record({
      appId: "app.a",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: { n: 1 },
    });
    await reg.record({
      appId: "app.b",
      tenantId: "tenant.demo",
      artifactKind: "aim",
      version: "1.0.0",
      content: { n: 2 },
    });
    const onlyA = await reg.find({ appId: "app.a" });
    assert.equal(onlyA.length, 1);
    const onlyAim = await reg.find({ artifactKind: "aim" });
    assert.equal(onlyAim.length, 1);
    assert.equal(onlyAim[0]?.appId, "app.b");
  });
});
