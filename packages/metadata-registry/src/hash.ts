// Canonical JSON serialisation + sha256 content-hashing.
//
// Rules mirror the workspace-wide convention (see ai-provenance-store,
// governance-validator, canonical-application-generator):
//   * undefined-valued keys are dropped
//   * object keys sorted lexicographically by UTF-16 code unit
//   * arrays preserve insertion order

import { createHash } from "node:crypto";

import type { Json, JsonObject } from "./types.js";

function sortObject(value: Json): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sortObject(v as Json));
  const src = value as { readonly [key: string]: Json | undefined };
  const keys = Object.keys(src)
    .filter((k) => src[k] !== undefined)
    .sort((a, b) => a.localeCompare(b));
  const out: { [key: string]: Json } = {};
  for (const k of keys) out[k] = sortObject(src[k] as Json);
  return out;
}

export function canonicalizeJson(value: JsonObject): Json {
  return sortObject(value);
}

export function canonicalizeJsonString(value: JsonObject): string {
  return JSON.stringify(canonicalizeJson(value));
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Compute the content-addressed id of an artifact body. Format:
 * `sha256:<64-lowercase-hex>`. Two artifacts with byte-identical
 * canonicalised bytes produce the same id.
 */
export function computeContentHash(content: JsonObject): string {
  return `sha256:${sha256Hex(canonicalizeJsonString(content))}`;
}
