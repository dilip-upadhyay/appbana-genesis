/**
 * Small crypto + prompt-hashing helpers used by both Claude adapters.
 */

import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

/** Canonical JSON stringification (sorted keys) used for `inputHash`. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort((a, b) =>
      a.localeCompare(b),
    );
    for (const key of keys) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Cheap deterministic token estimate used for budget arithmetic. Real
 * production adapters SHOULD use `@anthropic-ai/tokenizer` when available;
 * the heuristic keeps the reference adapter dependency-free.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
