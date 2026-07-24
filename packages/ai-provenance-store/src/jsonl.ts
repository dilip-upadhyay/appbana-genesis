/**
 * `JsonlAIProvenanceStore` — durable append-only backend for local dev and
 * air-gapped demos. Each stored entry is one JSON object per line:
 *
 *   {"id":"sha256:...","insertedAt":"2026-07-24T12:34:56.789Z","record":{...}}
 *
 * On startup the file is read into memory. Every subsequent `record()` call:
 *
 *   1. Serializes the entry to a single line.
 *   2. Appends the line + `\n` to the file with `flag: "a"`.
 *   3. Inserts into the in-memory index.
 *
 * The write is a single append, so partial writes leave prior entries intact.
 * A malformed trailing line at startup is treated as a diagnostic — the entry
 * is dropped and the caller receives it via `loadWarnings()`. This mirrors the
 * behaviour of Postgres COPY-recovery on incomplete rows.
 *
 * Single-writer per file. Multi-writer safety is a Postgres-driver concern.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AIProvenanceRecord } from "@appbana/adapter-ai-contract";

import { recordId } from "./hash.js";
import {
  applyLimit,
  matchesFilter,
  projectRefRecords,
  sortByInsertedAt,
} from "./query.js";
import type {
  AIProvenanceStore,
  ProvenanceQuery,
  ProvenanceRefRecord,
  StoredEntry,
} from "./types.js";

export interface JsonlStoreConfig {
  readonly filePath: string;
  readonly now?: () => Date;
}

interface LoadWarning {
  readonly line: number;
  readonly reason: string;
}

export class JsonlAIProvenanceStore implements AIProvenanceStore {
  private readonly filePath: string;
  private readonly entries = new Map<string, StoredEntry>();
  private readonly now: () => Date;
  private readonly warnings: LoadWarning[] = [];
  private loaded = false;

  public constructor(config: JsonlStoreConfig) {
    this.filePath = config.filePath;
    this.now = config.now ?? (() => new Date());
  }

  public static async open(
    config: JsonlStoreConfig,
  ): Promise<JsonlAIProvenanceStore> {
    const s = new JsonlAIProvenanceStore(config);
    await s.load();
    return s;
  }

  /** Diagnostics collected while parsing the file at startup. */
  public loadWarnings(): readonly LoadWarning[] {
    return this.warnings;
  }

  public async record(record: AIProvenanceRecord): Promise<StoredEntry> {
    await this.ensureLoaded();
    const id = recordId(record);
    const existing = this.entries.get(id);
    if (existing !== undefined) return existing;
    const entry: StoredEntry = {
      id,
      insertedAt: this.now().toISOString(),
      record,
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    this.entries.set(id, entry);
    return entry;
  }

  public async get(id: string): Promise<StoredEntry | undefined> {
    await this.ensureLoaded();
    return this.entries.get(id);
  }

  public async query(
    filter?: ProvenanceQuery,
  ): Promise<readonly StoredEntry[]> {
    await this.ensureLoaded();
    const filtered = [...this.entries.values()]
      .filter((e) => matchesFilter(e, filter))
      .sort(sortByInsertedAt);
    return applyLimit(filtered, filter?.limit);
  }

  public async count(filter?: ProvenanceQuery): Promise<number> {
    await this.ensureLoaded();
    let n = 0;
    for (const e of this.entries.values()) {
      if (matchesFilter(e, filter)) n++;
    }
    if (filter?.limit !== undefined) return Math.min(n, filter.limit);
    return n;
  }

  public async listReferencedPromptVersions(): Promise<
    readonly ProvenanceRefRecord[]
  > {
    await this.ensureLoaded();
    const records = [...this.entries.values()].map((e) => e.record);
    return projectRefRecords(records);
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  private async load(): Promise<void> {
    this.loaded = true;
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if (isEnoent(err)) return;
      throw err;
    }
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.warnings.push({ line: i + 1, reason: "malformed JSON" });
        continue;
      }
      const entry = coerceStoredEntry(parsed);
      if (entry === undefined) {
        this.warnings.push({ line: i + 1, reason: "not a StoredEntry" });
        continue;
      }
      const expected = recordId(entry.record);
      if (entry.id !== expected) {
        this.warnings.push({
          line: i + 1,
          reason: `id mismatch: expected ${expected}, got ${entry.id}`,
        });
        continue;
      }
      this.entries.set(entry.id, entry);
    }
  }
}

function isEnoent(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

function coerceStoredEntry(parsed: unknown): StoredEntry | undefined {
  if (parsed === null || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  const id = obj["id"];
  const insertedAt = obj["insertedAt"];
  const record = obj["record"];
  if (typeof id !== "string") return undefined;
  if (typeof insertedAt !== "string") return undefined;
  if (record === null || typeof record !== "object") return undefined;
  return {
    id,
    insertedAt,
    record: record as AIProvenanceRecord,
  };
}
