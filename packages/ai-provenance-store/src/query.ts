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
  return matchesRecordFields(entry, filter) && matchesInsertedRange(entry, filter);
}

function matchesRecordFields(
  entry: StoredEntry,
  filter: ProvenanceQuery,
): boolean {
  const r = entry.record;
  const checks: readonly [string | undefined, string | undefined][] = [
    [filter.tenantId, r.tenantId],
    [filter.requestingAgent, r.requestingAgent],
    [filter.modelBinding, r.modelBinding],
    [filter.modelName, r.modelName],
    [filter.promptTemplateRef, r.promptTemplateRef],
    [filter.promptTemplateVersion, r.promptTemplateVersion],
  ];
  for (const [expected, actual] of checks) {
    if (expected !== undefined && actual !== expected) return false;
  }
  return true;
}

function matchesInsertedRange(
  entry: StoredEntry,
  filter: ProvenanceQuery,
): boolean {
  if (filter.since !== undefined && entry.insertedAt < filter.since) return false;
  if (filter.until !== undefined && entry.insertedAt > filter.until) return false;
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
