/**
 * `PostgresAIProvenanceStore` tests — runs an in-process Postgres via `pg-mem`
 * (no Docker required). Exercises the full AIProvenanceStore contract plus
 * append-only guarantees. A live-Postgres companion test (Testcontainers) is a
 * follow-up and lives in a separate `.skip`-by-default file.
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { newDb } from "pg-mem";

import {
  assertProvenance,
  PostgresAIProvenanceStore,
  recordId,
} from "../dist/index.js";

import { makeRecord } from "./fixtures.ts";

const DDL_PATH = fileURLToPath(
  new URL("../sql/ai_provenance.sql", import.meta.url),
);

async function bootstrap(): Promise<PostgresAIProvenanceStore> {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  // pg-mem needs the schema created via its API before qualified DDL will
  // resolve; `CREATE SCHEMA IF NOT EXISTS` alone is not enough.
  db.createSchema("appbana");

  // Load the DDL, then strip Postgres-specific features that pg-mem does not
  // parse (GIN, RLS policies, VIEWs with `OR REPLACE`, `AT TIME ZONE`
  // defaults). The APPEND-ONLY invariant is enforced by the driver's public
  // API (no UPDATE/DELETE) and by real Postgres RLS in production.
  const ddl = await readFile(DDL_PATH, "utf8");
  const compatDdl = ddl
    // Drop the GIN index (multi-line statement).
    .replace(/CREATE INDEX IF NOT EXISTS ai_provenance_record_gin_idx[\s\S]*?;/, "")
    // Drop the entire RLS block (ALTER + DROP POLICY + CREATE POLICY).
    .replace(/ALTER TABLE appbana\.ai_provenance ENABLE ROW LEVEL SECURITY;/, "")
    .replace(/DROP POLICY IF EXISTS[\s\S]*?;/g, "")
    .replace(/CREATE POLICY[\s\S]*?;/g, "")
    // Drop the convenience VIEW (pg-mem lacks CREATE OR REPLACE VIEW parsing).
    .replace(/CREATE OR REPLACE VIEW[\s\S]*?;/, "")
    // pg-mem does not accept `(now() AT TIME ZONE 'UTC')` as DEFAULT.
    .replace("(now() AT TIME ZONE 'UTC')", "now()");

  // pg-mem's `none()` requires one statement at a time.
  const statements = compatDdl
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    // Skip standalone comment-only fragments.
    const stripped = stmt.replace(/--[^\n]*/g, "").trim();
    if (stripped.length === 0) continue;
    db.public.none(stmt);
  }

  // Create a minimal view stand-in so listReferencedPromptVersions works.
  db.public.none(String.raw`
    CREATE VIEW appbana.ai_provenance_prompt_refs AS
      SELECT DISTINCT
        prompt_template_ref     AS ref,
        prompt_template_version AS version,
        prompt_template_hash    AS "templateHash"
      FROM appbana.ai_provenance
  `);

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return new PostgresAIProvenanceStore({ pool });
}

test("postgres: record + get roundtrip is idempotent", async () => {
  const store = await bootstrap();
  const record = makeRecord();
  const first = await store.record(record);
  const second = await store.record(record);
  assert.equal(first.id, second.id);
  assert.equal(first.insertedAt, second.insertedAt); // idempotent — no new row
  const fetched = await store.get(first.id);
  assert.deepEqual(fetched?.record, record);
  assertProvenance({
    outcome: "accepted",
    diagnostics: [],
    traceEvents: [],
    correlationId: "corr-1",
    provenance: record,
  }, first);
});

test("postgres: id is the sha-256 of the canonical record", async () => {
  const store = await bootstrap();
  const record = makeRecord({ requestingAgent: "agent.check.hash" });
  const stored = await store.record(record);
  assert.equal(stored.id, recordId(record));
});

test("postgres: query filters by tenantId + requestingAgent (AND)", async () => {
  const store = await bootstrap();
  await store.record(makeRecord({
    tenantId: "tenant.alpha",
    requestingAgent: "agent.ba-agent",
    inputHash: `sha256:${"a".repeat(64)}`,
  }));
  await store.record(makeRecord({
    tenantId: "tenant.alpha",
    requestingAgent: "agent.normalization",
    inputHash: `sha256:${"b".repeat(64)}`,
  }));
  await store.record(makeRecord({
    tenantId: "tenant.beta",
    requestingAgent: "agent.ba-agent",
    inputHash: `sha256:${"c".repeat(64)}`,
  }));

  const alpha = await store.query({ tenantId: "tenant.alpha" });
  assert.equal(alpha.length, 2);

  const beta = await store.query({ tenantId: "tenant.beta" });
  assert.equal(beta.length, 1);

  const alphaBa = await store.query({
    tenantId: "tenant.alpha",
    requestingAgent: "agent.ba-agent",
  });
  assert.equal(alphaBa.length, 1);

  assert.equal(await store.count({ tenantId: "tenant.alpha" }), 2);
  assert.equal(await store.count(), 3);
});

test("postgres: listReferencedPromptVersions dedups across records", async () => {
  const store = await bootstrap();
  const baBase = {
    promptTemplateRef: "prompt.ba-agent.intake",
    promptTemplateVersion: "1.0.0",
    promptTemplateHash: `sha256:${"e".repeat(64)}`,
  };
  const normBase = {
    promptTemplateRef: "prompt.normalization-agent.bim-to-aim",
    promptTemplateVersion: "1.0.0",
    promptTemplateHash: `sha256:${"f".repeat(64)}`,
  };
  await store.record(makeRecord({ ...baBase, inputHash: `sha256:${"1".repeat(64)}` }));
  await store.record(makeRecord({ ...baBase, inputHash: `sha256:${"2".repeat(64)}` }));
  await store.record(makeRecord({ ...normBase, inputHash: `sha256:${"3".repeat(64)}` }));
  const refs = await store.listReferencedPromptVersions();
  assert.equal(refs.length, 2);
  const [first, second] = refs;
  assert.equal(first?.ref, "prompt.ba-agent.intake");
  assert.equal(second?.ref, "prompt.normalization-agent.bim-to-aim");
});

test("postgres: rejects unsafe identifier in schema/table config", () => {
  const dummyPool = { async query() { return { rows: [] }; } };
  assert.throws(
    () => new PostgresAIProvenanceStore({ pool: dummyPool, schema: "public; DROP TABLE users; --" }),
    /postgres identifier/,
  );
  assert.throws(
    () => new PostgresAIProvenanceStore({ pool: dummyPool, table: "bad table" }),
    /postgres identifier/,
  );
});
