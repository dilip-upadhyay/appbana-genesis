/**
 * `PostgresAIProvenanceStore` — durable, multi-tenant backend built on the
 * `sql/ai_provenance.sql` DDL. Uses the `pg` client, declared as an OPTIONAL
 * peer dependency — install `pg` only in deployments that use this backend;
 * in-memory + JSONL work without it.
 *
 * The table is APPEND-ONLY (see `sql/ai_provenance.sql`). This driver never
 * issues UPDATE or DELETE.
 */

import type { AIProvenanceRecord } from "@appbana/adapter-ai-contract";

import { canonicalizeRecord, recordId } from "./hash.js";
import type {
  AIProvenanceStore,
  ProvenanceQuery,
  ProvenanceRefRecord,
  StoredEntry,
} from "./types.js";

/**
 * Structural mirror of the subset of `pg.PoolClient` / `pg.Pool` we need.
 * Keeping this local means the type signature does not force downstream
 * packages that never use Postgres to install `@types/pg`.
 */
export interface PgQueryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
}

export interface PostgresStoreConfig {
  /** A `pg.Pool` or any duck-typed queryable exposing `query(text, values)`. */
  readonly pool: PgQueryable;
  /** Table schema; defaults to `appbana`. */
  readonly schema?: string;
  /** Table name; defaults to `ai_provenance`. */
  readonly table?: string;
}

interface AiProvenanceRow {
  readonly id: string;
  readonly inserted_at: Date | string;
  readonly record: AIProvenanceRecord | string;
}

interface PromptRefRow {
  readonly ref: string;
  readonly version: string;
  readonly templateHash: string;
}

const DEFAULT_SCHEMA = "appbana";
const DEFAULT_TABLE = "ai_provenance";

export class PostgresAIProvenanceStore implements AIProvenanceStore {
  private readonly pool: PgQueryable;
  private readonly qualifiedTable: string;
  private readonly refsView: string;

  public constructor(config: PostgresStoreConfig) {
    const schema = config.schema ?? DEFAULT_SCHEMA;
    const table = config.table ?? DEFAULT_TABLE;
    validateIdentifier(schema);
    validateIdentifier(table);
    this.pool = config.pool;
    this.qualifiedTable = `${schema}.${table}`;
    this.refsView = `${schema}.ai_provenance_prompt_refs`;
  }

  public async record(record: AIProvenanceRecord): Promise<StoredEntry> {
    const id = recordId(record);
    // Serialize the record deterministically so hash-vs-content stays coherent
    // across re-reads.
    const canonical = canonicalizeRecord(record);
    const usage = record.tokenUsage;
    const sql = `
      INSERT INTO ${this.qualifiedTable} (
        id, ai_provenance_version, tenant_id, model_binding, model_name, model_version,
        prompt_template_ref, prompt_template_version, prompt_template_hash,
        input_hash, output_hash, requesting_agent, requested_at, completed_at,
        wall_clock_ms, token_input, token_output, token_total, record
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id, inserted_at, record
    `;
    const values: readonly unknown[] = [
      id,
      record.aiProvenanceVersion,
      record.tenantId,
      record.modelBinding,
      record.modelName,
      record.modelVersion,
      record.promptTemplateRef,
      record.promptTemplateVersion,
      record.promptTemplateHash,
      record.inputHash,
      record.outputHash,
      record.requestingAgent,
      record.requestedAt,
      record.completedAt,
      record.wallClockMs,
      usage.input,
      usage.output,
      usage.total,
      canonical,
    ];
    const inserted = await this.pool.query<AiProvenanceRow>(sql, values);
    if (inserted.rows.length > 0) {
      return rowToEntry(inserted.rows[0]!);
    }
    // Conflict — fetch the pre-existing row (idempotent insert).
    const existing = await this.get(id);
    if (existing === undefined) {
      throw new Error(
        `postgres store INSERT for id=${id} returned no row and no pre-existing row was found`,
      );
    }
    return existing;
  }

  public async get(id: string): Promise<StoredEntry | undefined> {
    const sql = `SELECT id, inserted_at, record FROM ${this.qualifiedTable} WHERE id = $1`;
    const res = await this.pool.query<AiProvenanceRow>(sql, [id]);
    if (res.rows.length === 0) return undefined;
    return rowToEntry(res.rows[0]!);
  }

  public async query(
    filter?: ProvenanceQuery,
  ): Promise<readonly StoredEntry[]> {
    const { where, values } = buildWhere(filter);
    const limitClause =
      filter?.limit !== undefined ? ` LIMIT ${asPositiveInt(filter.limit)}` : "";
    const sql = `SELECT id, inserted_at, record FROM ${this.qualifiedTable}${where} ORDER BY inserted_at ASC, id ASC${limitClause}`;
    const res = await this.pool.query<AiProvenanceRow>(sql, values);
    return res.rows.map(rowToEntry);
  }

  public async count(filter?: ProvenanceQuery): Promise<number> {
    const { where, values } = buildWhere(filter);
    const sql = `SELECT COUNT(*)::int AS n FROM ${this.qualifiedTable}${where}`;
    const res = await this.pool.query<{ n: number }>(sql, values);
    const raw = res.rows[0]?.n ?? 0;
    if (filter?.limit !== undefined) return Math.min(raw, filter.limit);
    return raw;
  }

  public async listReferencedPromptVersions(): Promise<readonly ProvenanceRefRecord[]> {
    const sql = `SELECT ref, version, "templateHash" FROM ${this.refsView} ORDER BY ref ASC, version ASC`;
    const res = await this.pool.query<PromptRefRow>(sql);
    return res.rows.map((r) => ({
      ref: r.ref,
      version: r.version,
      templateHash: r.templateHash,
    }));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToEntry(row: AiProvenanceRow): StoredEntry {
  const record: AIProvenanceRecord =
    typeof row.record === "string"
      ? (JSON.parse(row.record) as AIProvenanceRecord)
      : row.record;
  const insertedAt =
    row.inserted_at instanceof Date
      ? row.inserted_at.toISOString()
      : new Date(row.inserted_at).toISOString();
  return { id: row.id, insertedAt, record };
}

interface Where {
  readonly where: string;
  readonly values: readonly unknown[];
}

function buildWhere(filter: ProvenanceQuery | undefined): Where {
  if (filter === undefined) return { where: "", values: [] };
  const clauses: string[] = [];
  const values: unknown[] = [];
  const eq = (column: string, expected: string | undefined) => {
    if (expected === undefined) return;
    values.push(expected);
    clauses.push(`${column} = $${values.length}`);
  };
  eq("tenant_id", filter.tenantId);
  eq("requesting_agent", filter.requestingAgent);
  eq("model_binding", filter.modelBinding);
  eq("model_name", filter.modelName);
  eq("prompt_template_ref", filter.promptTemplateRef);
  eq("prompt_template_version", filter.promptTemplateVersion);
  if (filter.since !== undefined) {
    values.push(filter.since);
    clauses.push(`inserted_at >= $${values.length}`);
  }
  if (filter.until !== undefined) {
    values.push(filter.until);
    clauses.push(`inserted_at <= $${values.length}`);
  }
  if (clauses.length === 0) return { where: "", values: [] };
  return { where: ` WHERE ${clauses.join(" AND ")}`, values };
}

function asPositiveInt(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`limit must be a non-negative integer, got ${n}`);
  }
  return n;
}

const IDENTIFIER_PATTERN = String.raw`/^\w+$/`;

function validateIdentifier(id: string): void {
  if (!/^\w+$/.test(id)) {
    throw new Error(
      `postgres identifier ${JSON.stringify(id)} must match ${IDENTIFIER_PATTERN} (letters, digits, underscore)`,
    );
  }
}
