// Public barrel.

export type {
  ArtifactKind,
  ArtifactQuery,
  ArtifactSubmission,
  Json,
  JsonObject,
  MetadataRegistry,
  StoredArtifact,
} from "./types.js";
export {
  ARTIFACT_KINDS,
  ArtifactNotFoundError,
  ContentHashMismatchError,
  ProvenanceChainMismatchError,
} from "./types.js";

export {
  canonicalizeJson,
  canonicalizeJsonString,
  computeContentHash,
  sha256Hex,
} from "./hash.js";

export {
  readSourceHash,
  verifyContentHash,
  verifyProvenanceChain,
} from "./integrity.js";

export { InMemoryMetadataRegistry } from "./in-memory.js";
export type { InMemoryConfig } from "./in-memory.js";

export { JsonlMetadataRegistry } from "./jsonl.js";
export type { JsonlConfig, LoadWarning } from "./jsonl.js";

export { PostgresMetadataRegistry } from "./postgres.js";
export type { PgQueryable, PostgresConfig } from "./postgres.js";
