/**
 * Kernel-side `assertProvenance` guard — ADR-015 fail-closed check.
 *
 * The kernel calls this the moment an adapter returns. If provenance is
 * missing, structurally broken, or the store's returned id disagrees with the
 * recomputed content hash, the whole result is rejected before any downstream
 * consumer sees it.
 */

import type {
  AIInvocationResult,
  AIProvenanceRecord,
} from "@appbana/adapter-ai-contract";

import { recordId } from "./hash.js";
import { MissingProvenanceError, type StoredEntry } from "./types.js";

const REQUIRED_STRING_FIELDS = [
  "modelBinding",
  "modelName",
  "modelVersion",
  "promptTemplateRef",
  "promptTemplateVersion",
  "promptTemplateHash",
  "inputHash",
  "outputHash",
  "requestingAgent",
  "requestedAt",
  "completedAt",
] as const;

/**
 * Type-narrowing guard. Throws {@link MissingProvenanceError} on any violation.
 * If `stored` is supplied, additionally verifies that the store's returned id
 * matches the sha-256 of the canonicalized record on the result — proving the
 * store did not silently rewrite fields.
 */
export function assertProvenance(
  result: AIInvocationResult,
  stored?: StoredEntry,
): asserts result is AIInvocationResult & { readonly provenance: AIProvenanceRecord } {
  const p = result.provenance;
  if (p === undefined || p === null) {
    throw new MissingProvenanceError(
      "AI invocation result has no provenance record",
      { code: "PROVENANCE_MISSING" },
    );
  }

  if (p.aiProvenanceVersion !== "0.1") {
    throw new MissingProvenanceError(
      `unsupported aiProvenanceVersion "${p.aiProvenanceVersion}" (expected "0.1")`,
      { code: "PROVENANCE_VERSION_UNSUPPORTED" },
    );
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    const v = p[field];
    if (typeof v !== "string" || v.length === 0) {
      throw new MissingProvenanceError(
        `provenance field "${field}" is missing or empty`,
        { code: "PROVENANCE_FIELD_MISSING", missingField: field },
      );
    }
  }

  if (
    typeof p.wallClockMs !== "number" ||
    !Number.isFinite(p.wallClockMs) ||
    p.wallClockMs < 0
  ) {
    throw new MissingProvenanceError(
      "provenance field \"wallClockMs\" must be a non-negative finite number",
      { code: "PROVENANCE_FIELD_MISSING", missingField: "wallClockMs" },
    );
  }

  const usage = p.tokenUsage;
  if (
    usage === undefined ||
    typeof usage.input !== "number" ||
    typeof usage.output !== "number" ||
    typeof usage.total !== "number"
  ) {
    throw new MissingProvenanceError(
      "provenance field \"tokenUsage\" must supply input/output/total counts",
      { code: "PROVENANCE_FIELD_MISSING", missingField: "tokenUsage" },
    );
  }

  if (!Array.isArray(p.redactions)) {
    throw new MissingProvenanceError(
      "provenance field \"redactions\" must be an array (empty is fine)",
      { code: "PROVENANCE_FIELD_MISSING", missingField: "redactions" },
    );
  }

  if (stored !== undefined) {
    const expected = recordId(p);
    if (stored.id !== expected) {
      throw new MissingProvenanceError(
        `store returned id ${stored.id} but the record hashes to ${expected} — the store must not mutate records`,
        {
          code: "PROVENANCE_ID_MISMATCH",
          expectedId: expected,
          actualId: stored.id,
        },
      );
    }
  }
}
