/**
 * `@appbana/ai-provenance-store` types.
 *
 * The store is intentionally **append-only**: no update, no delete. Records
 * are content-addressed so identical invocations dedupe. `id` is the sha-256
 * of the canonicalized record — see {@link canonicalizeRecord}.
 */

import type { AIProvenanceRecord } from "@appbana/adapter-ai-contract";

export const PROVENANCE_STORE_VERSION = "0.1" as const;

/**
 * Structural mirror of `@appbana/prompt-template-registry`'s ProvenanceRefRecord.
 *
 * Kept as a local interface (rather than importing the registry package) so the
 * store has no runtime dependency on the registry. `prompt-registry-check`
 * consumes an array of these from JSON — the coupling is over-the-wire, not
 * at type-level.
 */
export interface ProvenanceRefRecord {
  readonly ref: string;
  readonly version: string;
  readonly templateHash?: string;
}

/** One row in the provenance store. */
export interface StoredEntry {
  /** Content-addressed id — `sha256:<hex>` of the canonicalized record. */
  readonly id: string;
  /** ISO-8601 UTC timestamp when the entry was inserted. */
  readonly insertedAt: string;
  readonly record: AIProvenanceRecord;
}

/** Filter accepted by `query` and `count`. All fields AND together. */
export interface ProvenanceQuery {
  /** Match `record.tenantId` exactly. */
  readonly tenantId?: string;
  /** Match `record.requestingAgent` exactly. */
  readonly requestingAgent?: string;
  /** Match `record.modelBinding` exactly. */
  readonly modelBinding?: string;
  /** Match `record.modelName` exactly. */
  readonly modelName?: string;
  /** Match `record.promptTemplateRef` exactly. */
  readonly promptTemplateRef?: string;
  /** Match `record.promptTemplateVersion` exactly. */
  readonly promptTemplateVersion?: string;
  /** Include only entries with `insertedAt >= since` (ISO-8601). */
  readonly since?: string;
  /** Include only entries with `insertedAt <= until` (ISO-8601). */
  readonly until?: string;
  /** Max number of rows to return. Applied AFTER filtering, ordered oldest first. */
  readonly limit?: number;
}

/**
 * Portable interface implemented by every backend. Every method is async so
 * the same signature works for in-memory, JSONL, and future Postgres backends.
 */
export interface AIProvenanceStore {
  /**
   * Insert a record. Idempotent — if the same canonicalized record is stored
   * twice, the second call returns the original {@link StoredEntry} unchanged.
   */
  record(record: AIProvenanceRecord): Promise<StoredEntry>;

  /** Fetch by content id. */
  get(id: string): Promise<StoredEntry | undefined>;

  /** Return matching entries ordered oldest first. */
  query(filter?: ProvenanceQuery): Promise<readonly StoredEntry[]>;

  /** Count matching entries without materializing them. */
  count(filter?: ProvenanceQuery): Promise<number>;

  /**
   * Distinct `(promptTemplateRef, promptTemplateVersion, promptTemplateHash)`
   * triples observed across every stored record. Consumed by
   * `prompt-registry-check --provenance-refs` in CI.
   */
  listReferencedPromptVersions(): Promise<readonly ProvenanceRefRecord[]>;

  /** Optional lifecycle hook for backends that hold file handles or sockets. */
  close?(): Promise<void>;
}

/** Thrown by {@link import("./assert.js").assertProvenance}. */
export class MissingProvenanceError extends Error {
  public readonly code: string;
  public readonly missingField?: string;
  public readonly expectedId?: string;
  public readonly actualId?: string;

  public constructor(
    message: string,
    detail: {
      code: string;
      missingField?: string;
      expectedId?: string;
      actualId?: string;
    },
  ) {
    super(message);
    this.name = "MissingProvenanceError";
    this.code = detail.code;
    if (detail.missingField !== undefined) this.missingField = detail.missingField;
    if (detail.expectedId !== undefined) this.expectedId = detail.expectedId;
    if (detail.actualId !== undefined) this.actualId = detail.actualId;
  }
}
