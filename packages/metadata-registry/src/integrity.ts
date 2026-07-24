// Integrity verification helpers.
//
// * `verifyContentHash` — recomputes the hash of a StoredArtifact's content
//   and throws ContentHashMismatchError on drift. Called on every read from
//   every driver so a tampered row cannot silently pass through the API.
// * `verifyProvenanceChain` — checks the BIM→AIM→CAM triple's
//   sourceBim.contentHash / sourceAim.contentHash back-references. This is the
//   integrity primitive the governance-validator + platform kernel will call
//   to prove that a CAM was actually generated from the referenced AIM which
//   was actually derived from the referenced BIM.

import { computeContentHash } from "./hash.js";
import {
  ContentHashMismatchError,
  ProvenanceChainMismatchError,
  type JsonObject,
  type StoredArtifact,
} from "./types.js";

/**
 * Assert that `stored.content` hashes to `stored.id`. Throws
 * ContentHashMismatchError otherwise. Returns the recomputed hash on success.
 */
export function verifyContentHash(stored: StoredArtifact): string {
  const computed = computeContentHash(stored.content);
  if (computed !== stored.id) {
    throw new ContentHashMismatchError(stored.id, computed);
  }
  return computed;
}

/**
 * Extract the declared upstream content hash from an artifact body. AIM
 * points at BIM via `sourceBim.contentHash`; CAM points at AIM via
 * `metadata.sourceAim.contentHash` (envelope path). Returns undefined when
 * the field is missing or not a string.
 */
export function readSourceHash(
  artifact: JsonObject,
  kind: "aim" | "cam",
): string | undefined {
  if (kind === "aim") {
    const source = artifact["sourceBim"];
    if (!isObject(source)) return undefined;
    const h = source["contentHash"];
    return typeof h === "string" ? h : undefined;
  }
  // cam
  const meta = artifact["metadata"];
  if (!isObject(meta)) return undefined;
  const source = meta["sourceAim"];
  if (!isObject(source)) return undefined;
  const h = source["contentHash"];
  return typeof h === "string" ? h : undefined;
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Verify the BIM→AIM→CAM provenance chain. Throws
 * ProvenanceChainMismatchError on the first mismatch. Placeholder hashes
 * `sha256:__pending__` are accepted (the AIM v0.1 schema explicitly permits
 * them; they indicate an as-yet-unpinned upstream).
 */
export function verifyProvenanceChain(
  bim: JsonObject,
  aim: JsonObject,
  cam: JsonObject,
): { readonly bimHash: string; readonly aimHash: string; readonly camHash: string } {
  const bimHash = computeContentHash(bim);
  const aimHash = computeContentHash(aim);
  const camHash = computeContentHash(cam);

  const aimDeclaredBim = readSourceHash(aim, "aim");
  if (
    aimDeclaredBim !== undefined &&
    aimDeclaredBim !== "sha256:__pending__" &&
    aimDeclaredBim !== bimHash
  ) {
    throw new ProvenanceChainMismatchError("aim.sourceBim", aimDeclaredBim, bimHash);
  }

  const camDeclaredAim = readSourceHash(cam, "cam");
  if (
    camDeclaredAim !== undefined &&
    camDeclaredAim !== "sha256:__pending__" &&
    camDeclaredAim !== aimHash
  ) {
    throw new ProvenanceChainMismatchError("cam.sourceAim", camDeclaredAim, aimHash);
  }

  return { bimHash, aimHash, camHash };
}
