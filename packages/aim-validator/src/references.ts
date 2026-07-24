/**
 * Cross-reference resolution.
 *
 * Walks the AIM depth-first. For every object encountered, checks each
 * property key against the configured reference rules and validates the
 * value(s) against the pre-built symbol table.
 *
 * Reports two error kinds:
 *   - `AIM_UNKNOWN_REF` \u2014 the ref resolves to nothing in the symbol table.
 *   - `AIM_WRONG_KIND` \u2014 the ref resolves but points to a different element kind
 *     than the rule expects (e.g. an `enumRef` pointing at a `role`).
 *
 * Element-level refs only. Field-path references inside rule expressions
 * (`entity.customer.country`) are out of scope for v0.1.
 */

import type {
  AimDocument,
  AimReferenceError,
  AimReferenceRule,
  AimSymbolKind,
  AimSymbolTable,
} from "./types.js";
import { DEFAULT_AIM_REFERENCE_RULES } from "./ref-rules.js";

/**
 * Every AIM identifier follows the `<kind>.<slug>...` shape. This map decides
 * which kind a candidate string belongs to based on its leading token.
 */
const PREFIX_TO_KIND: Readonly<Record<string, AimSymbolKind>> = {
  role: "role",
  enum: "enum",
  entity: "entity",
  "state-machine": "state-machine",
  operation: "operation",
  rule: "rule",
};

export interface ResolveReferencesOptions {
  readonly rules?: readonly AimReferenceRule[];
}

export function resolveReferences(
  aim: AimDocument,
  symbols: AimSymbolTable,
  options: ResolveReferencesOptions = {},
): readonly AimReferenceError[] {
  const rules = options.rules ?? DEFAULT_AIM_REFERENCE_RULES;
  const rulesByKey = indexRules(rules);
  const errors: AimReferenceError[] = [];
  walk(aim, "", rulesByKey, symbols, errors);
  return errors;
}

function indexRules(
  rules: readonly AimReferenceRule[],
): ReadonlyMap<string, AimReferenceRule> {
  const map = new Map<string, AimReferenceRule>();
  for (const rule of rules) {
    map.set(rule.key, rule);
  }
  return map;
}

function walk(
  value: unknown,
  path: string,
  rulesByKey: ReadonlyMap<string, AimReferenceRule>,
  symbols: AimSymbolTable,
  errors: AimReferenceError[],
): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}/${i}`, rulesByKey, symbols, errors));
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}/${escapePointerToken(k)}`;
    const rule = rulesByKey.get(k);
    if (rule !== undefined) {
      checkRule(rule, v, childPath, symbols, errors);
    }
    // Continue walking regardless \u2014 nested structures may hold more refs.
    walk(v, childPath, rulesByKey, symbols, errors);
  }
}

function checkRule(
  rule: AimReferenceRule,
  value: unknown,
  path: string,
  symbols: AimSymbolTable,
  errors: AimReferenceError[],
): void {
  if (rule.cardinality === "scalar") {
    if (typeof value !== "string") return; // schema validation catches type errors
    checkSingleRef(rule, value, path, symbols, errors);
    return;
  }
  if (!Array.isArray(value)) return;
  value.forEach((item, i) => {
    if (typeof item !== "string") return;
    checkSingleRef(rule, item, `${path}/${i}`, symbols, errors);
  });
}

function checkSingleRef(
  rule: AimReferenceRule,
  value: string,
  path: string,
  symbols: AimSymbolTable,
  errors: AimReferenceError[],
): void {
  const kind = kindOf(value);
  if (kind === undefined) {
    // Value does not look like any AIM element identifier; the schema layer is
    // responsible for enforcing string format. Skip to avoid false positives on
    // free-form strings that happen to sit under a ref-carrying key.
    return;
  }

  if (!rule.expects.includes(kind)) {
    errors.push({
      path,
      ref: value,
      rule: rule.key,
      expected: rule.expects,
      message: `${rule.key} at ${path} points to a ${kind} (${value}) but must point to ${describeExpected(rule.expects)}`,
    });
    return;
  }

  const lookupId =
    rule.allowVersionSuffix === true ? stripVersionSuffix(value) : value;
  const suffixed = value !== lookupId ? value : undefined;
  const symbol = symbols.byId.get(lookupId) ?? symbols.byId.get(value);
  if (symbol === undefined) {
    const suggestion = suggest(value, symbols, rule.expects);
    const err: AimReferenceError = suggestion === undefined
      ? {
          path,
          ref: value,
          rule: rule.key,
          expected: rule.expects,
          message: `${rule.key} at ${path} references unknown ${kind} '${value}'${suffixed !== undefined ? " (version suffix stripped)" : ""}`,
        }
      : {
          path,
          ref: value,
          rule: rule.key,
          expected: rule.expects,
          closestSuggestion: suggestion,
          message: `${rule.key} at ${path} references unknown ${kind} '${value}' \u2014 did you mean '${suggestion}'?`,
        };
    errors.push(err);
  }
}

function kindOf(value: string): AimSymbolKind | undefined {
  const dot = value.indexOf(".");
  if (dot < 1) return undefined;
  const prefix = value.slice(0, dot);
  return PREFIX_TO_KIND[prefix];
}

function stripVersionSuffix(value: string): string {
  const idx = value.lastIndexOf(":v");
  if (idx <= 0) return value;
  const tail = value.slice(idx + 2);
  return /^\d+$/.test(tail) ? value.slice(0, idx) : value;
}

function describeExpected(kinds: readonly AimSymbolKind[]): string {
  if (kinds.length === 1) return `a ${kinds[0]}`;
  return `one of {${kinds.join(", ")}}`;
}

/** Levenshtein-based nearest-neighbor within the expected kinds. */
function suggest(
  value: string,
  symbols: AimSymbolTable,
  expected: readonly AimSymbolKind[],
): string | undefined {
  const candidates: string[] = [];
  for (const kind of expected) {
    const bucket = symbols.byKind.get(kind);
    if (bucket === undefined) continue;
    for (const s of bucket) candidates.push(s.id);
  }
  if (candidates.length === 0) return undefined;
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const d = levenshtein(value, c);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  // Only suggest if reasonably close (edit distance <= 40% of longer length).
  const threshold = Math.max(2, Math.floor(Math.max(value.length, best?.length ?? 0) * 0.4));
  return best !== undefined && bestDistance <= threshold ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.codePointAt(i - 1) === b.codePointAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] ?? 0;
}

function escapePointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}
