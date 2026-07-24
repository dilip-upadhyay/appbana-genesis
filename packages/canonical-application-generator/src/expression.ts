/**
 * AIM rule-expression shorthand -> CAM canonical AST.
 *
 * See the README's mapping table. The generator converts AIM's key-driven
 * shorthand (e.g. `{eq: [a, b]}`) into the discriminated `{op, ...}` form the
 * CAM Rules Runtime consumes. Unknown ops fall back to `{op: "always"}` with an
 * `EXPR_UNMAPPED` diagnostic so the generator still produces a schema-valid
 * CAM the operator can inspect.
 */

import { CAM_GEN_DIAGNOSTIC_CODES, type JsonObject } from "./types.js";
import { DiagnosticCollector, looksLikePath } from "./diagnostics.js";

const BINARY_COMPARATORS = new Set(["eq", "neq", "lt", "lte", "gt", "gte"]);

export function mapExpression(
  expr: unknown,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  if (expr === null || typeof expr !== "object" || Array.isArray(expr)) {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EXPR_UNMAPPED,
      path,
      `expression at ${path} is not an object; falling back to {op:"always"}`,
    );
    return { op: "always" };
  }

  const rec = expr as Record<string, unknown>;
  const keys = Object.keys(rec);

  // Explicit {op: "..."} form (already canonical, e.g. AIM `op: "all-required-fields-set"`).
  if ("op" in rec && typeof rec["op"] === "string") {
    return handleExplicitOp(rec, path, diagnostics);
  }

  // Single-key shorthand: {always: true}, {eq: [..]}, {ref: "rule.x"}, ...
  if (keys.length !== 1) {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EXPR_UNMAPPED,
      path,
      `expression at ${path} is not single-keyed shorthand; falling back to {op:"always"}`,
    );
    return { op: "always" };
  }

  const key = keys[0]!;
  const value = rec[key];
  return mapShorthand(key, value, path, diagnostics);
}

function mapShorthand(
  key: string,
  value: unknown,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  switch (key) {
    case "always":
    case "never":
      return { op: key };

    case "all":
    case "any":
      return mapBoolean(key === "all" ? "and" : "or", value, path, diagnostics);

    case "and":
    case "or":
      return mapBoolean(key, value, path, diagnostics);

    case "not":
      return { op: "not", operand: mapExpression(value, `${path}/not`, diagnostics) };

    case "ref":
      if (typeof value === "string") return { op: "ref", ruleId: value };
      break;

    case "role-is":
      if (typeof value === "string") return { op: "role-is", roleId: value };
      break;

    case "in":
      return mapIn(value, path, diagnostics);

    case "matches":
      return mapMatches(value, path, diagnostics);

    default:
      if (BINARY_COMPARATORS.has(key) && Array.isArray(value) && value.length === 2) {
        return {
          op: key,
          left: mapOperand(value[0]),
          right: mapOperand(value[1]),
        };
      }
  }

  diagnostics.warn(
    CAM_GEN_DIAGNOSTIC_CODES.EXPR_UNMAPPED,
    path,
    `expression shorthand '${key}' at ${path} not recognised; falling back to {op:"always"}`,
  );
  return { op: "always" };
}

function handleExplicitOp(
  rec: Record<string, unknown>,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  diagnostics.warn(
    CAM_GEN_DIAGNOSTIC_CODES.EXPR_UNMAPPED,
    path,
    `expression at ${path} uses custom op '${rec["op"] as string}' not in the CAM v0.1 AST; falling back to {op:"always"}`,
  );
  return { op: "always" };
}

function mapBoolean(
  op: "and" | "or",
  value: unknown,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  if (!Array.isArray(value)) {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EXPR_UNMAPPED,
      path,
      `${op} operand at ${path} is not an array; falling back to {op:"always"}`,
    );
    return { op: "always" };
  }
  if (value.length === 0) {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.BOOLEAN_UNWRAPPED,
      path,
      `${op} at ${path} has zero operands; falling back to {op:"always"}`,
    );
    return { op: "always" };
  }
  if (value.length === 1) {
    diagnostics.info(
      CAM_GEN_DIAGNOSTIC_CODES.BOOLEAN_UNWRAPPED,
      path,
      `${op} at ${path} has a single operand and was unwrapped (CAM AST requires min 2)`,
    );
    return mapExpression(value[0], `${path}/${op}/0`, diagnostics);
  }
  const operands = value.map((v, i) =>
    mapExpression(v, `${path}/${op}/${i}`, diagnostics),
  );
  return { op, operands };
}

function mapIn(
  value: unknown,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  if (!Array.isArray(value) || value.length !== 2) {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EXPR_UNMAPPED,
      path,
      `in at ${path} expects [value, list]; falling back to {op:"always"}`,
    );
    return { op: "always" };
  }
  const [inValue, list] = value;
  if (!Array.isArray(list)) {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EXPR_UNMAPPED,
      path,
      `in list at ${path}/in/1 is not an array; falling back to {op:"always"}`,
    );
    return { op: "always" };
  }
  return {
    op: "in",
    value: mapOperand(inValue),
    list: list.map((item) => mapOperand(item)),
  };
}

function mapMatches(
  value: unknown,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[1] !== "string") {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EXPR_UNMAPPED,
      path,
      `matches at ${path} expects [value, pattern]; falling back to {op:"always"}`,
    );
    return { op: "always" };
  }
  return {
    op: "matches",
    value: mapOperand(value[0]),
    pattern: value[1],
  };
}

/** Bare string that "looks like" a field path -> `{path}`; anything else -> `{literal}`. */
export function mapOperand(value: unknown): JsonObject {
  if (typeof value === "string" && looksLikePath(value)) {
    return { path: value };
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { literal: value };
  }
  // Objects/arrays as operands are not standard in AIM v0.1; emit as literal for
  // completeness (the CAM validator will reject if inappropriate).
  return { literal: value as Json };
}

// Locally aliased to avoid a cross-file `import type` cycle.
type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [k: string]: Json };
