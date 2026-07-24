/**
 * Deterministic canonical-JSON hasher for BIM documents.
 *
 * The Normalization Agent stores `bimContentHash = sha256(canonicalJson(bim))` on
 * every result so downstream consumers (metadata registry, governance gate) can
 * prove that the AIM was produced from the exact BIM bytes recorded here.
 *
 * Canonicalization rules (identical to `@appbana/ai-provenance-store`):
 *   1. Drop keys whose value is `undefined`.
 *   2. Recursively sort object keys ascending.
 *   3. Preserve array order (arrays are ordered data).
 *   4. Serialize with `JSON.stringify` (no whitespace).
 */

import { createHash } from "node:crypto";

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function contentHash(value: unknown): string {
  return `sha256:${sha256Hex(canonicalizeJson(value))}`;
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, sortValue(v)] as const);
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = v;
  return out;
}
