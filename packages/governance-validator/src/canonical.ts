// Canonical JSON serialisation (JCS/RFC 8785-lite) and content-hashing helpers.
//
// Rules (mirroring canonical-application-generator/hash.ts so signed report
// bytes are reproducible across every publisher):
//   * `undefined`-valued keys are dropped
//   * object keys are sorted lexicographically by UTF-16 code unit
//   * arrays preserve insertion order
//   * numbers use `JSON.stringify` output (Phase 1 keeps this simple; strict
//     RFC 8785 numeric canonicalisation is a Phase 2 follow-up when signing
//     infrastructure lands)

import { createHash } from "node:crypto";

import type { Json, GateReport } from "./types.js";

function sortObject(value: Json): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sortObject(v as Json));
  const src = value as { readonly [key: string]: Json | undefined };
  const keys = Object.keys(src)
    .filter((k) => src[k] !== undefined)
    .sort(compareCodeUnits);
  const out: { [key: string]: Json } = {};
  for (const k of keys) {
    out[k] = sortObject(src[k] as Json);
  }
  return out;
}

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Return canonicalised JSON with undefined keys dropped and object keys sorted. */
export function canonicalizeJson(value: Json): Json {
  return sortObject(value);
}

/** Return the canonicalised bytes as a UTF-8 string. */
export function canonicalizeJsonString(value: Json): string {
  return JSON.stringify(canonicalizeJson(value));
}

/** sha256 hex digest of `input`. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Content-hash for any JSON value; format is `sha256:<64-lowercase-hex>`. */
export function contentHash(value: Json): string {
  return `sha256:${sha256Hex(canonicalizeJsonString(value))}`;
}

/**
 * Content-hash of a GateReport. The hash MUST be reproducible byte-for-byte
 * across publishers so a downstream verifier can prove the report has not been
 * tampered with. Signatures (Phase 2) sign the same canonical bytes.
 */
export function reportContentHash(report: GateReport): string {
  return contentHash(report as unknown as Json);
}

/** Canonical UTF-8 bytes of a GateReport — what signatures sign. */
export function canonicalReportBytes(report: GateReport): Buffer {
  return Buffer.from(canonicalizeJsonString(report as unknown as Json), "utf8");
}
