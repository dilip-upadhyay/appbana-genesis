// PostgresMetadataRegistry — durable, multi-tenant backend built on the
// `sql/metadata_artifacts.sql` DDL. Uses `pg` (or any duck-typed pool). The
// dep is optional at package.json level so in-memory + JSONL work without it.
//
// The table is APPEND-ONLY (RLS grants SELECT + INSERT only). This driver
// never issues UPDATE or DELETE.

import { computeContentHash, canonicalizeJsonString } from "./hash.js";
import { verifyContentHash } from "./integrity.js";
import type {
  ArtifactKind,
  ArtifactQuery,
  ArtifactSubmission,
  JsonObject,
  MetadataRegistry,
  StoredArtifact,
} from "./types.js";

/**
 * Structural mirror of `pg.Pool` / `pg.PoolClient`. Local so downstream
 * packages that never use Postgres do not have to install `@types/pg`.
 */
export interface PgQueryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
}

export interface PostgresConfig {
  readonly pool: PgQueryable;
  readonly schema?: string;
  readonly table?: string;
}

interface ArtifactRow {
  readonly id: string;
  readonly inserted_at: Date | string;
  readonly app_id: string;
  readonly tenant_id: string;
  readonly artifact_kind: ArtifactKind;
  readonly version: string;
  readonly content: JsonObject | string;
}

const DEFAULT_SCHEMA = "appbana";
const DEFAULT_TABLE = "metadata_artifacts";
const IDENTIFIER_PATTERN = /^\w+$/;

function validateIdentifier(id: string): void {
  if (!IDENTIFIER_PATTERN.test(id)) {
    throw new Error(`invalid Postgres identifier "${id}" — allowed characters are [A-Za-z0-9_]`);
  }
}

export class PostgresMetadataRegistry implements MetadataRegistry {
  private readonly pool: PgQueryable;
  private readonly qualifiedTable: string;

  constructor(config: PostgresConfig) {
    const schema = config.schema ?? DEFAULT_SCHEMA;
    const table = config.table ?? DEFAULT_TABLE;
    validateIdentifier(schema);
    validateIdentifier(table);
    this.pool = config.pool;
    this.qualifiedTable = `${schema}.${table}`;
  }

  async record(submission: ArtifactSubmission): Promise<StoredArtifact> {
    const id = computeContentHash(submission.content);
    const canonical = canonicalizeJsonString(submission.content);
    const sql = `
      INSERT INTO ${this.qualifiedTable} (id, app_id, tenant_id, artifact_kind, version, content)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (id) DO NOTHING
      RETURNING id, inserted_at, app_id, tenant_id, artifact_kind, version, content
    `;
    const values: readonly unknown[] = [
      id,
      submission.appId,
      submission.tenantId,
      submission.artifactKind,
      submission.version,
      canonical,
    ];
    const inserted = await this.pool.query<ArtifactRow>(sql, values);
    if (inserted.rows.length > 0) return rowToEntry(inserted.rows[0]!);
    const existing = await this.get(id);
    if (existing === undefined) {
      throw new Error(
        `metadata-registry INSERT for id=${id} returned no row and no pre-existing row was found`,
      );
    }
    return existing;
  }

  async get(id: string): Promise<StoredArtifact | undefined> {
    const sql = `SELECT id, inserted_at, app_id, tenant_id, artifact_kind, version, content FROM ${this.qualifiedTable} WHERE id = $1`;
    const res = await this.pool.query<ArtifactRow>(sql, [id]);
    if (res.rows.length === 0) return undefined;
    const entry = rowToEntry(res.rows[0]!);
    verifyContentHash(entry);
    return entry;
  }

  async find(filter?: ArtifactQuery): Promise<readonly StoredArtifact[]> {
    const { where, values } = buildWhere(filter);
    const limitClause =
      filter?.limit !== undefined ? ` LIMIT ${asPositiveInt(filter.limit)}` : "";
    const sql = `SELECT id, inserted_at, app_id, tenant_id, artifact_kind, version, content FROM ${this.qualifiedTable}${where} ORDER BY inserted_at ASC, id ASC${limitClause}`;
    const res = await this.pool.query<ArtifactRow>(sql, values);
    const entries = res.rows.map(rowToEntry);
    for (const e of entries) verifyContentHash(e);
    return entries;
  }

  async count(filter?: ArtifactQuery): Promise<number> {
    const { where, values } = buildWhere(filter);
    const sql = `SELECT COUNT(*)::int AS n FROM ${this.qualifiedTable}${where}`;
    const res = await this.pool.query<{ n: number }>(sql, values);
    const raw = res.rows[0]?.n ?? 0;
    if (filter?.limit !== undefined) return Math.min(raw, filter.limit);
    return raw;
  }
}

function rowToEntry(row: ArtifactRow): StoredArtifact {
  const content: JsonObject =
    typeof row.content === "string"
      ? (JSON.parse(row.content) as JsonObject)
      : row.content;
  const insertedAt =
    row.inserted_at instanceof Date
      ? row.inserted_at.toISOString()
      : new Date(row.inserted_at).toISOString();
  return {
    id: row.id,
    contentHash: row.id,
    appId: row.app_id,
    tenantId: row.tenant_id,
    artifactKind: row.artifact_kind,
    version: row.version,
    content,
    insertedAt,
  };
}

interface Where {
  readonly where: string;
  readonly values: readonly unknown[];
}

function buildWhere(filter: ArtifactQuery | undefined): Where {
  if (filter === undefined) return { where: "", values: [] };
  const clauses: string[] = [];
  const values: unknown[] = [];
  const eq = (column: string, expected: string | undefined): void => {
    if (expected === undefined) return;
    values.push(expected);
    clauses.push(`${column} = $${String(values.length)}`);
  };
  eq("app_id", filter.appId);
  eq("tenant_id", filter.tenantId);
  eq("artifact_kind", filter.artifactKind);
  eq("version", filter.version);
  if (filter.since !== undefined) {
    values.push(filter.since);
    clauses.push(`inserted_at >= $${String(values.length)}`);
  }
  if (filter.until !== undefined) {
    values.push(filter.until);
    clauses.push(`inserted_at < $${String(values.length)}`);
  }
  return { where: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "", values };
}

function asPositiveInt(n: number): number {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`invalid LIMIT ${String(n)} — must be a non-negative integer`);
  }
  return n;
}
