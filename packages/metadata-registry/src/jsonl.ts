// JsonlMetadataRegistry — durable append-only backend for local dev and
// air-gapped demos. Each line is a single JSON object:
//
//   {"id":"sha256:...","insertedAt":"...","record":{...}}
//
// where `record` is the StoredArtifact envelope without redundant fields.
//
// On startup the file is streamed line-by-line into an in-memory index.
// Malformed lines are dropped and surfaced via `loadWarnings()` — same
// COPY-recovery behaviour as `JsonlAIProvenanceStore`.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { computeContentHash } from "./hash.js";
import { verifyContentHash } from "./integrity.js";
import { applyLimit, matchesFilter, sortByInsertedAt } from "./query.js";
import type {
  ArtifactQuery,
  ArtifactSubmission,
  MetadataRegistry,
  StoredArtifact,
} from "./types.js";

export interface JsonlConfig {
  readonly filePath: string;
  readonly now?: () => Date;
}

export interface LoadWarning {
  readonly line: number;
  readonly reason: string;
}

interface DiskEntry {
  readonly id: string;
  readonly insertedAt: string;
  readonly record: {
    readonly appId: string;
    readonly tenantId: string;
    readonly artifactKind: StoredArtifact["artifactKind"];
    readonly version: string;
    readonly content: StoredArtifact["content"];
  };
}

export class JsonlMetadataRegistry implements MetadataRegistry {
  private readonly filePath: string;
  private readonly entries = new Map<string, StoredArtifact>();
  private readonly now: () => Date;
  private readonly warnings: LoadWarning[] = [];
  private loaded = false;

  constructor(config: JsonlConfig) {
    this.filePath = config.filePath;
    this.now = config.now ?? (() => new Date());
  }

  loadWarnings(): readonly LoadWarning[] {
    return this.warnings;
  }

  async record(submission: ArtifactSubmission): Promise<StoredArtifact> {
    await this.ensureLoaded();
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
    await this.appendLine(entry);
    this.entries.set(id, entry);
    return entry;
  }

  async get(id: string): Promise<StoredArtifact | undefined> {
    await this.ensureLoaded();
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    verifyContentHash(entry);
    return entry;
  }

  async find(filter?: ArtifactQuery): Promise<readonly StoredArtifact[]> {
    await this.ensureLoaded();
    const matched: StoredArtifact[] = [];
    for (const entry of this.entries.values()) {
      verifyContentHash(entry);
      if (matchesFilter(entry, filter)) matched.push(entry);
    }
    return applyLimit(sortByInsertedAt(matched), filter?.limit);
  }

  async count(filter?: ArtifactQuery): Promise<number> {
    await this.ensureLoaded();
    let n = 0;
    for (const entry of this.entries.values()) {
      if (matchesFilter(entry, filter)) n += 1;
    }
    if (filter?.limit !== undefined) return Math.min(n, filter.limit);
    return n;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    const lines = raw.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.length === 0) return;
      const lineNo = idx + 1;
      let disk: DiskEntry;
      try {
        disk = JSON.parse(line) as DiskEntry;
      } catch (parseErr) {
        this.warnings.push({
          line: lineNo,
          reason: `malformed JSON: ${errorMessage(parseErr)}`,
        });
        return;
      }
      if (!isDiskEntry(disk)) {
        this.warnings.push({ line: lineNo, reason: "missing required fields" });
        return;
      }
      const computed = computeContentHash(disk.record.content);
      if (computed !== disk.id) {
        this.warnings.push({
          line: lineNo,
          reason: `id ${disk.id} does not match recomputed hash ${computed}`,
        });
        return;
      }
      this.entries.set(disk.id, {
        id: disk.id,
        appId: disk.record.appId,
        tenantId: disk.record.tenantId,
        artifactKind: disk.record.artifactKind,
        version: disk.record.version,
        contentHash: disk.id,
        content: disk.record.content,
        insertedAt: disk.insertedAt,
      });
    });
  }

  private async appendLine(entry: StoredArtifact): Promise<void> {
    const disk: DiskEntry = {
      id: entry.id,
      insertedAt: entry.insertedAt,
      record: {
        appId: entry.appId,
        tenantId: entry.tenantId,
        artifactKind: entry.artifactKind,
        version: entry.version,
        content: entry.content,
      },
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(disk)}\n`, { flag: "a" });
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return Object.prototype.toString.call(err);
  }
}

function isDiskEntry(v: unknown): v is DiskEntry {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o["id"] !== "string") return false;
  if (typeof o["insertedAt"] !== "string") return false;
  const r = o["record"];
  if (typeof r !== "object" || r === null) return false;
  const rr = r as Record<string, unknown>;
  if (typeof rr["appId"] !== "string") return false;
  if (typeof rr["tenantId"] !== "string") return false;
  if (typeof rr["artifactKind"] !== "string") return false;
  if (typeof rr["version"] !== "string") return false;
  if (typeof rr["content"] !== "object" || rr["content"] === null) return false;
  return true;
}
