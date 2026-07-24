/**
 * Canonical JSON hashing helpers.
 *
 * Same contract as `@appbana/normalization-agent/hash`:
 *   - drop `undefined`-valued keys;
 *   - recursively sort object keys;
 *   - preserve array order;
 *   - JSON.stringify without whitespace;
 *   - sha256 -> `sha256:<hex>`.
 */

import { createHash } from "node:crypto";

export function canonicalizeJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  entries.sort(([a], [b]) => compareStrings(a, b));
  for (const [k, v] of entries) {
    out[k] = canonicalizeJson(v);
  }
  return out;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sha256Hex(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function contentHash(value: unknown): string {
  const canonical = canonicalizeJson(value);
  const bytes = JSON.stringify(canonical);
  return `sha256:${sha256Hex(bytes)}`;
}
