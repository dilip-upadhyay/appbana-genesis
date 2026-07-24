/**
 * Redaction engine — pure function over `Record<string, unknown>`.
 *
 * Walks the input tree, applies every rule to every string value, and returns
 * both the redacted tree and the `redactions[]` audit array the caller records
 * onto the AI provenance record.
 */

import { createHash } from "node:crypto";

import type { AIProvenanceRedaction } from "@appbana/adapter-ai-contract";

import type {
  RedactionAction,
  RedactionResult,
  RedactionRule,
} from "./rules.js";

const DEFAULT_MASK = "[REDACTED]";
const TRUNCATE_KEEP = 4;

interface WalkContext {
  readonly rules: readonly RedactionRule[];
  readonly redactions: AIProvenanceRedaction[];
}

/**
 * Apply `rules` to every string leaf in `inputs`. Non-string values (numbers,
 * booleans, null) are copied as-is. Arrays and plain objects are walked
 * recursively; other object shapes (Maps, class instances) are copied by
 * reference — callers should canonicalise inputs to JSON-safe values first.
 */
export function redact(
  inputs: Readonly<Record<string, unknown>>,
  rules: readonly RedactionRule[],
): RedactionResult {
  const ctx: WalkContext = { rules, redactions: [] };
  const redactedInputs = walkRecord(inputs, "/inputs", ctx);
  return {
    redactedInputs,
    redactions: ctx.redactions,
  };
}

function walkRecord(
  value: Readonly<Record<string, unknown>>,
  pointer: string,
  ctx: WalkContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = walkAny(child, `${pointer}/${encodePointerSegment(key)}`, ctx);
  }
  return out;
}

function walkAny(value: unknown, pointer: string, ctx: WalkContext): unknown {
  if (typeof value === "string") {
    return redactString(value, pointer, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => walkAny(item, `${pointer}/${i}`, ctx));
  }
  if (value !== null && typeof value === "object" && isPlainObject(value)) {
    return walkRecord(value as Record<string, unknown>, pointer, ctx);
  }
  return value;
}

function redactString(
  value: string,
  pointer: string,
  ctx: WalkContext,
): unknown {
  let current: string | null = value;
  let removed = false;

  for (const rule of ctx.rules) {
    if (current === null) break;
    // Clone pattern so lastIndex state does not leak across values.
    const pattern = cloneRegex(rule.pattern);
    if (!pattern.test(current)) continue;

    ctx.redactions.push({
      path: pointer,
      classification: rule.classification,
      action: rule.action,
      ...(rule.policyRef !== undefined ? { policyRef: rule.policyRef } : {}),
    });

    current = applyAction(current, rule, cloneRegex(rule.pattern));
    if (current === null) {
      removed = true;
      break;
    }
  }

  return removed ? null : current;
}

function applyAction(
  value: string,
  rule: RedactionRule,
  pattern: RegExp,
): string | null {
  const action: RedactionAction = rule.action;
  switch (action) {
    case "masked":
      return value.replace(pattern, rule.maskWith ?? DEFAULT_MASK);
    case "hashed":
      return value.replace(pattern, (m) => hashToken(m));
    case "truncated":
      return value.length <= TRUNCATE_KEEP
        ? value
        : `${value.slice(0, TRUNCATE_KEEP)}…`;
    case "removed":
      return null;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function hashToken(token: string): string {
  const hex = createHash("sha256").update(token).digest("hex");
  return `sha256:${hex.slice(0, 16)}`;
}

function cloneRegex(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}

/**
 * JSON Pointer segment encoding per RFC 6901 §3.
 * Replaces `~` with `~0` and `/` with `~1`.
 */
function encodePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
