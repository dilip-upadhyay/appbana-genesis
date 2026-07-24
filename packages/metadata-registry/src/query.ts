// Shared query helpers used by the in-memory and JSONL drivers.

import type { ArtifactQuery, StoredArtifact } from "./types.js";

function matchesString<K extends keyof ArtifactQuery>(
  filter: ArtifactQuery,
  entry: StoredArtifact,
  key: K & keyof StoredArtifact,
): boolean {
  const expected = filter[key];
  if (expected === undefined) return true;
  return entry[key] === (expected as unknown);
}

function matchesInsertedRange(
  filter: ArtifactQuery,
  entry: StoredArtifact,
): boolean {
  if (filter.since !== undefined && entry.insertedAt < filter.since) return false;
  if (filter.until !== undefined && entry.insertedAt >= filter.until) return false;
  return true;
}

export function matchesFilter(
  entry: StoredArtifact,
  filter: ArtifactQuery | undefined,
): boolean {
  if (filter === undefined) return true;
  if (!matchesString(filter, entry, "appId")) return false;
  if (!matchesString(filter, entry, "tenantId")) return false;
  if (!matchesString(filter, entry, "artifactKind")) return false;
  if (!matchesString(filter, entry, "version")) return false;
  if (!matchesInsertedRange(filter, entry)) return false;
  return true;
}

export function sortByInsertedAt(
  entries: readonly StoredArtifact[],
): readonly StoredArtifact[] {
  return [...entries].sort((a, b) => {
    if (a.insertedAt !== b.insertedAt) return a.insertedAt.localeCompare(b.insertedAt);
    return a.id.localeCompare(b.id);
  });
}

export function applyLimit(
  entries: readonly StoredArtifact[],
  limit: number | undefined,
): readonly StoredArtifact[] {
  if (limit === undefined) return entries;
  if (limit < 0) return [];
  return entries.slice(0, limit);
}
