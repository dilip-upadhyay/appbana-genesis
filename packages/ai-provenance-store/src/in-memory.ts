/**
 * `InMemoryAIProvenanceStore` — reference backend for tests and ephemeral
 * demos. Not durable. Not thread-safe across worker threads.
 *
 * Optionally accepts an injected `now()` clock for deterministic tests.
 */

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

export interface InMemoryStoreConfig {
  readonly now?: () => Date;
}

export class InMemoryAIProvenanceStore implements AIProvenanceStore {
  private readonly entries = new Map<string, StoredEntry>();
  private readonly now: () => Date;

  public constructor(config: InMemoryStoreConfig = {}) {
    this.now = config.now ?? (() => new Date());
  }

  public record(record: AIProvenanceRecord): Promise<StoredEntry> {
    const id = recordId(record);
    const existing = this.entries.get(id);
    if (existing !== undefined) return Promise.resolve(existing);
    const entry: StoredEntry = {
      id,
      insertedAt: this.now().toISOString(),
      record,
    };
    this.entries.set(id, entry);
    return Promise.resolve(entry);
  }

  public get(id: string): Promise<StoredEntry | undefined> {
    return Promise.resolve(this.entries.get(id));
  }

  public query(
    filter?: ProvenanceQuery,
  ): Promise<readonly StoredEntry[]> {
    const filtered = [...this.entries.values()]
      .filter((e) => matchesFilter(e, filter))
      .sort(sortByInsertedAt);
    return Promise.resolve(applyLimit(filtered, filter?.limit));
  }

  public count(filter?: ProvenanceQuery): Promise<number> {
    let n = 0;
    for (const e of this.entries.values()) {
      if (matchesFilter(e, filter)) n++;
    }
    if (filter?.limit !== undefined) return Promise.resolve(Math.min(n, filter.limit));
    return Promise.resolve(n);
  }

  public listReferencedPromptVersions(): Promise<readonly ProvenanceRefRecord[]> {
    const records = [...this.entries.values()].map((e) => e.record);
    return Promise.resolve(projectRefRecords(records));
  }
}
