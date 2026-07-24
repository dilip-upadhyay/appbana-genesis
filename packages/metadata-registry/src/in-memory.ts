// InMemoryMetadataRegistry — for tests and short-lived processes. Backed by a
// Map<id, StoredArtifact>. Idempotent record() dedupes by content hash.

import { computeContentHash } from "./hash.js";
import { verifyContentHash } from "./integrity.js";
import { applyLimit, matchesFilter, sortByInsertedAt } from "./query.js";
import type {
  ArtifactQuery,
  ArtifactSubmission,
  MetadataRegistry,
  StoredArtifact,
} from "./types.js";

export interface InMemoryConfig {
  readonly now?: () => Date;
}

export class InMemoryMetadataRegistry implements MetadataRegistry {
  private readonly entries = new Map<string, StoredArtifact>();
  private readonly now: () => Date;

  constructor(config: InMemoryConfig = {}) {
    this.now = config.now ?? (() => new Date());
  }

  async record(submission: ArtifactSubmission): Promise<StoredArtifact> {
    const id = computeContentHash(submission.content);
    const existing = this.entries.get(id);
    if (existing !== undefined) return existing;
    const entry: StoredArtifact = {
      id,
      appId: submission.appId,
      tenantId: submission.tenantId,
      artifactKind: submission.artifactKind,
      version: submission.version,
      contentHash: id,
      content: submission.content,
      insertedAt: this.now().toISOString(),
    };
    this.entries.set(id, entry);
    return entry;
  }

  async get(id: string): Promise<StoredArtifact | undefined> {
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    verifyContentHash(entry);
    return entry;
  }

  async find(filter?: ArtifactQuery): Promise<readonly StoredArtifact[]> {
    const matched: StoredArtifact[] = [];
    for (const entry of this.entries.values()) {
      verifyContentHash(entry);
      if (matchesFilter(entry, filter)) matched.push(entry);
    }
    return applyLimit(sortByInsertedAt(matched), filter?.limit);
  }

  async count(filter?: ArtifactQuery): Promise<number> {
    let n = 0;
    for (const entry of this.entries.values()) {
      if (matchesFilter(entry, filter)) n += 1;
    }
    if (filter?.limit !== undefined) return Math.min(n, filter.limit);
    return n;
  }
}
