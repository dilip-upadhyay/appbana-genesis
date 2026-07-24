/**
 * Deterministic canonicalization + content-hashing for provenance records.
 *
 * Two records with the same *meaningful* content hash to the same id even if
 * their JSON key order differs or optional fields are omitted vs. `undefined`.
 * The canonical form:
 *
 * 1. Drops any property whose value is `undefined`.
 * 2. Recursively sorts object keys.
 * 3. Preserves array element order.
 * 4. JSON.stringify without pretty-print.
 *
 * The hash is then `sha256:<hex>` of the UTF-8 bytes.
 */

import { createHash } from "node:crypto";

import type { AIProvenanceRecord } from "@appbana/adapter-ai-contract";

export function canonicalizeRecord(record: AIProvenanceRecord): string {
  return JSON.stringify(sortValue(record));
}

export function recordId(record: AIProvenanceRecord): string {
  const canonical = canonicalizeRecord(record);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hex}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => sortValue(v));
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = sortValue(obj[k]);
    }
    return out;
  }
  return value;
}
