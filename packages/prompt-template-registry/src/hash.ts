/**
 * Deterministic hashing for prompt template bodies. Canonicalization
 * normalizes line endings to LF so hashes are stable across Windows/Linux
 * checkouts.
 */

import { createHash } from "node:crypto";

/** Normalize CRLF/CR to LF. */
export function canonicalizeBody(raw: string): string {
  return raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/**
 * `sha256:<hex>` of the canonicalized body. This is the value stored in
 * `PromptTemplateMeta.sha256` and returned by `RenderedPrompt.templateHash`.
 */
export function promptTemplateHash(body: string): string {
  const canonical = canonicalizeBody(body);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * `sha256:<hex>` of an already-rendered prompt string. No canonicalization is
 * applied — the caller controls the exact bytes that are hashed.
 */
export function renderedPromptHash(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}
