/**
 * Local hashing + canonicalization helpers. Duplicates the Claude adapter's
 * hashing.ts so each adapter package stays independently deployable.
 */

import { createHash } from "node:crypto";

export function sha256Hex(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/**
 * RFC-8785-style canonical JSON (object keys sorted). Sufficient for stable
 * hashing of adapter inputs and outputs.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(src).sort((a, b) => a.localeCompare(b));
    for (const k of keys) {
      out[k] = sortKeys(src[k]);
    }
    return out;
  }
  return value;
}

/** Cheap upper bound. Same 4-chars-per-token heuristic as the Claude adapter. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
