// @appbana/metadata-registry — public types.
//
// The registry is APPEND-ONLY and CONTENT-ADDRESSED. Every artifact is keyed
// by the sha-256 hash of its canonicalised JSON. Two writes of the same bytes
// return the pre-existing StoredArtifact (idempotent). Reads recompute the
// hash and throw ContentHashMismatchError on drift.

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json | undefined };

export type JsonObject = { readonly [key: string]: Json | undefined };

/** The three artifact kinds the registry stores. */
export type ArtifactKind = "bim" | "aim" | "cam";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ["bim", "aim", "cam"];

/** Input to `record()`. The registry computes the id from `content`. */
export interface ArtifactSubmission {
  /**
   * Owning application id — e.g. `"app.customer-onboarding"`. Every artifact
   * belongs to exactly one app for the purpose of `(appId, kind, version)`
   * queries.
   */
  readonly appId: string;
  /** Tenant this artifact belongs to. Enforced by Postgres RLS. */
  readonly tenantId: string;
  /** Which of the three canonical artifacts this is. */
  readonly artifactKind: ArtifactKind;
  /**
   * Semver of the artifact itself — mirrors the artifact's own `version`
   * field. Held as a top-level column so `(appId, artifactKind, version)`
   * queries do not require deserialising `content`.
   */
  readonly version: string;
  /** The full canonicalisation-friendly body. */
  readonly content: JsonObject;
}

/** A stored row. */
export interface StoredArtifact {
  /** Content-addressed id, format `sha256:<64-lowercase-hex>`. */
  readonly id: string;
  readonly appId: string;
  readonly tenantId: string;
  readonly artifactKind: ArtifactKind;
  readonly version: string;
  readonly contentHash: string; // same as `id`
  readonly content: JsonObject;
  /** ISO-8601 UTC — set on insert, never changes. */
  readonly insertedAt: string;
}

/** Filter accepted by `find()`. All fields AND together. */
export interface ArtifactQuery {
  readonly appId?: string;
  readonly tenantId?: string;
  readonly artifactKind?: ArtifactKind;
  readonly version?: string;
  /** `insertedAt >= since` (ISO-8601 UTC). */
  readonly since?: string;
  /** `insertedAt < until` (ISO-8601 UTC). */
  readonly until?: string;
  readonly limit?: number;
}

/** Backend-agnostic interface. Every driver honours the append-only contract. */
export interface MetadataRegistry {
  /**
   * Insert an artifact. Idempotent by content hash — writing the same bytes
   * twice returns the pre-existing StoredArtifact (first-writer-wins on the
   * denormalised columns like `appId`, `version`, `tenantId`).
   */
  record(submission: ArtifactSubmission): Promise<StoredArtifact>;
  /**
   * Look up by content-addressed id. Reads recompute the hash and throw
   * ContentHashMismatchError if the stored bytes have drifted.
   */
  get(id: string): Promise<StoredArtifact | undefined>;
  /**
   * List artifacts matching `filter`, sorted `(insertedAt ASC, id ASC)`.
   */
  find(filter?: ArtifactQuery): Promise<readonly StoredArtifact[]>;
  /** Same filter, count only. */
  count(filter?: ArtifactQuery): Promise<number>;
}

/** Thrown when a stored artifact's bytes do not hash to its declared id. */
export class ContentHashMismatchError extends Error {
  readonly code = "CONTENT_HASH_MISMATCH";
  readonly declaredId: string;
  readonly computedHash: string;
  constructor(declaredId: string, computedHash: string) {
    super(
      `stored artifact id ${declaredId} does not match recomputed content hash ${computedHash} — bytes have drifted`,
    );
    this.declaredId = declaredId;
    this.computedHash = computedHash;
  }
}

/** Thrown when `get(id)` is called with a required id that is absent. */
export class ArtifactNotFoundError extends Error {
  readonly code = "ARTIFACT_NOT_FOUND";
  readonly artifactId: string;
  constructor(artifactId: string) {
    super(`artifact ${artifactId} not found`);
    this.artifactId = artifactId;
  }
}

/**
 * Thrown by `verifyProvenanceChain` when a link in the BIM→AIM→CAM chain does
 * not match the referenced upstream content hash.
 */
export class ProvenanceChainMismatchError extends Error {
  readonly code = "PROVENANCE_CHAIN_MISMATCH";
  readonly linkKind: "aim.sourceBim" | "cam.sourceAim";
  readonly expectedHash: string;
  readonly actualHash: string;
  constructor(
    linkKind: "aim.sourceBim" | "cam.sourceAim",
    expectedHash: string,
    actualHash: string,
  ) {
    super(
      `${linkKind} declares upstream content hash "${expectedHash}" but the linked artifact hashes to "${actualHash}"`,
    );
    this.linkKind = linkKind;
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}
