import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import { newDb, type IMemoryDb } from "pg-mem";

import {
  PostgresMetadataRegistry,
  computeContentHash,
} from "../dist/index.js";

import { AIM_FIXTURE, BIM_FIXTURE, CAM_FIXTURE } from "./fixtures.ts";

async function bootstrap(): Promise<IMemoryDb> {
  const db = newDb();
  // pg-mem requires the schema to be explicitly created even though the DDL
  // includes `CREATE SCHEMA IF NOT EXISTS`.
  db.createSchema("appbana");
  const raw = await readFile(
    join(process.cwd(), "sql", "metadata_artifacts.sql"),
    "utf8",
  );
  // Strip DDL fragments pg-mem 3.x does not implement, and replace the
  // (now() AT TIME ZONE 'UTC') default with plain now(). See phase0 memory
  // notes for the full recipe.
  const stripped = raw
    // pg-mem lacks the AT TIME ZONE cast at DEFAULT time
    .replace(/\(now\(\)\s+AT\s+TIME\s+ZONE\s+'UTC'\)/gi, "now()")
    // pg-mem doesn't implement ROW LEVEL SECURITY / policies — the tests
    // exercise application-level fencing separately.
    .replace(/ALTER\s+TABLE[^;]+ENABLE\s+ROW\s+LEVEL\s+SECURITY[^;]*;/gi, "")
    .replace(/DROP\s+POLICY[^;]+;/gi, "")
    .replace(/CREATE\s+POLICY[^;]+;/gi, "");
  const statements = stripped
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
  for (const stmt of statements) {
    db.public.none(stmt);
  }
  return db;
}

describe("PostgresMetadataRegistry", () => {
  let db: IMemoryDb;

  before(async () => {
    db = await bootstrap();
  });

  it("record → get returns the stored row with a well-formed id", async () => {
    const pool = db.adapters.createPg().Pool;
    const registry = new PostgresMetadataRegistry({
      pool: new pool() as unknown as import("../dist/index.js").PgQueryable,
    });
    const stored = await registry.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    assert.equal(stored.id, computeContentHash(BIM_FIXTURE));
    const fetched = await registry.get(stored.id);
    assert.ok(fetched);
    assert.equal(fetched.id, stored.id);
    assert.equal(fetched.artifactKind, "bim");
  });

  it("record is idempotent — same bytes twice returns the first row (ON CONFLICT DO NOTHING)", async () => {
    const pool = db.adapters.createPg().Pool;
    const registry = new PostgresMetadataRegistry({
      pool: new pool() as unknown as import("../dist/index.js").PgQueryable,
    });
    const a = await registry.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "aim",
      version: "1.0.0",
      content: AIM_FIXTURE,
    });
    const b = await registry.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "aim",
      version: "1.0.0",
      content: AIM_FIXTURE,
    });
    assert.equal(a.id, b.id);
    assert.equal(a.insertedAt, b.insertedAt);
    const one = await registry.count({ artifactKind: "aim" });
    assert.equal(one, 1);
  });

  it("find filters by (appId, artifactKind, version)", async () => {
    const pool = db.adapters.createPg().Pool;
    const registry = new PostgresMetadataRegistry({
      pool: new pool() as unknown as import("../dist/index.js").PgQueryable,
    });
    await registry.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "cam",
      version: "1.0.0",
      content: CAM_FIXTURE,
    });
    const cams = await registry.find({
      appId: "app.customer-onboarding",
      artifactKind: "cam",
      version: "1.0.0",
    });
    assert.equal(cams.length, 1);
    assert.equal(cams[0]?.artifactKind, "cam");
  });

  it("find filters by tenantId", async () => {
    const pool = db.adapters.createPg().Pool;
    const registry = new PostgresMetadataRegistry({
      pool: new pool() as unknown as import("../dist/index.js").PgQueryable,
    });
    await registry.record({
      appId: "app.beta",
      tenantId: "tenant.beta",
      artifactKind: "bim",
      version: "1.0.0",
      content: { app: "beta", n: 1 },
    });
    const beta = await registry.find({ tenantId: "tenant.beta" });
    assert.equal(beta.length, 1);
    assert.equal(beta[0]?.appId, "app.beta");
  });

  it("rejects invalid schema/table identifiers (SQL-injection guard)", () => {
    const pool = db.adapters.createPg().Pool;
    assert.throws(
      () =>
        new PostgresMetadataRegistry({
          pool: new pool() as unknown as import("../dist/index.js").PgQueryable,
          schema: "appbana; DROP TABLE users; --",
        }),
      /invalid Postgres identifier/,
    );
    assert.throws(
      () =>
        new PostgresMetadataRegistry({
          pool: new pool() as unknown as import("../dist/index.js").PgQueryable,
          table: "metadata_artifacts;--",
        }),
      /invalid Postgres identifier/,
    );
  });
});
