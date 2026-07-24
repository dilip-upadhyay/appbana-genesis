/**
 * Shared query-matching + ref-projection logic used by every backend.
 * Kept separate so a future Postgres driver can translate the same filter
 * into SQL without re-deriving the semantics.
 */

import type { AIProvenanceRecord } from "@appbana/adapter-ai-contract";

import type {
  ProvenanceQuery,
  ProvenanceRefRecord,
  StoredEntry,
} from "./types.js";

export function matchesFilter(
  entry: StoredEntry,
  filter: ProvenanceQuery | undefined,
): boolean {
  if (filter === undefined) return true;
  const r = entry.record;
  if (
    filter.requestingAgent !== undefined &&
    r.requestingAgent !== filter.requestingAgent
  ) {
    return false;
  }
  if (
    filter.modelBinding !== undefined &&
    r.modelBinding !== filter.modelBinding
  ) {
    return false;
  }
  if (filter.modelName !== undefined && r.modelName !== filter.modelName) {
    return false;
  }
  if (
    filter.promptTemplateRef !== undefined &&
    r.promptTemplateRef !== filter.promptTemplateRef
  ) {
    return false;
  }
  if (
    filter.promptTemplateVersion !== undefined &&
    r.promptTemplateVersion !== filter.promptTemplateVersion
  ) {
    return false;
  }
  if (filter.since !== undefined && entry.insertedAt < filter.since) {
    return false;
  }
  if (filter.until !== undefined && entry.insertedAt > filter.until) {
    return false;
  }
  return true;
}

export function applyLimit<T>(items: readonly T[], limit: number | undefined): T[] {
  if (limit === undefined) return [...items];
  if (limit < 0) return [];
  return items.slice(0, limit);
}

export function sortByInsertedAt(a: StoredEntry, b: StoredEntry): number {
  if (a.insertedAt < b.insertedAt) return -1;
  if (a.insertedAt > b.insertedAt) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function projectRefRecords(
  records: Iterable<AIProvenanceRecord>,
): ProvenanceRefRecord[] {
  const seen = new Map<string, ProvenanceRefRecord>();
  for (const r of records) {
    const key = `${r.promptTemplateRef}@${r.promptTemplateVersion}@${r.promptTemplateHash}`;
    if (!seen.has(key)) {
      seen.set(key, {
        ref: r.promptTemplateRef,
        version: r.promptTemplateVersion,
        templateHash: r.promptTemplateHash,
      });
    }
  }
  return [...seen.values()].sort((a, b) => {
    const refCmp = a.ref.localeCompare(b.ref);
    if (refCmp !== 0) return refCmp;
    return a.version.localeCompare(b.version);
  });
}
