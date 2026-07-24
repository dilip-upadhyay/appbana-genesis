/**
 * RuleModel builder.
 *
 * Rule kinds are preserved verbatim. Expressions inside `when`, `condition`,
 * and `cases[].when` are canonicalised via `mapExpression`. AIM rule actions
 * are lightly renamed (`types` -> `documentTypes` on `require-documents`).
 *
 * `field-visibility` rules in AIM carry `allowRoles`/`denyRoles` at the rule
 * root; the CAM shape puts them inside a synthetic `when: {op:"always"}` +
 * `then: [{action:"set-visibility", visibility: {allowRoles, denyRoles}}]`
 * wrapper. Targets are preserved.
 */

import { CAM_GEN_DIAGNOSTIC_CODES, type JsonObject } from "./types.js";
import type { DiagnosticCollector } from "./diagnostics.js";
import { mapExpression } from "./expression.js";

const KNOWN_RULE_KINDS = new Set([
  "field-requirement",
  "field-constraint",
  "field-visibility",
  "document-requirement",
  "derived-field",
  "transition-guard",
]);

const THEN_KEY = "then";
const WHEN_KEY = "when";

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export function buildRuleModel(
  aimRules: readonly JsonObject[],
  subModelVersion: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  return {
    version: subModelVersion,
    rules: aimRules.map((r, i) => transformRule(r, i, diagnostics)),
  };
}

function transformRule(
  rule: JsonObject,
  index: number,
  diagnostics: DiagnosticCollector,
): JsonObject {
  const path = `/rules/${index}`;
  const out: Record<string, unknown> = {};
  const kind = normaliseKind(rule["kind"], path, diagnostics);

  out["id"] = rule["id"];
  out["kind"] = kind;
  out["description"] = typeof rule["description"] === "string"
    ? rule["description"]
    : `Rule ${safeString(rule["id"])}`;
  out["priority"] = typeof rule["priority"] === "number" ? rule["priority"] : 100;

  if (typeof rule["id"] === "string") {
    // sourceAimRuleId documents which AIM rule this CAM rule was generated from.
    out["sourceAimRuleId"] = rule["id"];
  }

  if ("when" in rule && rule["when"] !== undefined) {
    out["when"] = mapExpression(rule["when"], `${path}/when`, diagnostics);
  }
  if ("condition" in rule && rule["condition"] !== undefined) {
    out["condition"] = mapExpression(rule["condition"], `${path}/condition`, diagnostics);
  }

  if (Array.isArray(rule[THEN_KEY])) {
    Reflect.set(
      out,
      THEN_KEY,
      (rule[THEN_KEY] as readonly unknown[]).map((a) => transformAction(a as JsonObject)),
    );
  }
  if (Array.isArray(rule["cases"])) {
    out["cases"] = rule["cases"].map((c, i) => transformCase(c as JsonObject, `${path}/cases/${i}`, diagnostics));
  }
  if (rule["target"] !== undefined) out["target"] = rule["target"];
  if (Array.isArray(rule["targets"])) out["targets"] = rule["targets"];

  if (kind === "field-visibility") {
    synthesiseVisibilityWrapper(rule, out);
  }

  return out as JsonObject;
}

function synthesiseVisibilityWrapper(rule: JsonObject, out: Record<string, unknown>): void {
  if (out["when"] === undefined) out["when"] = { op: "always" };
  const allowRoles = Array.isArray(rule["allowRoles"]) ? rule["allowRoles"] : undefined;
  const denyRoles = Array.isArray(rule["denyRoles"]) ? rule["denyRoles"] : undefined;
  if (allowRoles === undefined && denyRoles === undefined) return;
  const visibility: Record<string, unknown> = {};
  if (allowRoles !== undefined) visibility["allowRoles"] = allowRoles;
  if (denyRoles !== undefined) visibility["denyRoles"] = denyRoles;
  Reflect.set(out, THEN_KEY, [{ action: "set-visibility", visibility }]);
}

function transformCase(
  caseDef: JsonObject,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  const when = mapExpression(caseDef[WHEN_KEY], `${path}/when`, diagnostics);
  const rawThen = Array.isArray(caseDef[THEN_KEY]) ? (caseDef[THEN_KEY] as readonly unknown[]) : [];
  const then = rawThen.map((a) => transformAction(a as JsonObject));
  const result: Record<string, unknown> = {};
  Reflect.set(result, WHEN_KEY, when);
  Reflect.set(result, THEN_KEY, then);
  return result as JsonObject;
}

function transformAction(action: JsonObject): JsonObject {
  const out: Record<string, unknown> = { ...action };
  if (action["action"] === "require-documents" && Array.isArray(action["types"])) {
    out["documentTypes"] = action["types"];
    delete out["types"];
  }
  return out as JsonObject;
}

function normaliseKind(
  kind: unknown,
  path: string,
  diagnostics: DiagnosticCollector,
): string {
  if (typeof kind === "string" && KNOWN_RULE_KINDS.has(kind)) return kind;
  diagnostics.warn(
    CAM_GEN_DIAGNOSTIC_CODES.RULE_KIND_DEFAULT,
    path,
    `rule.kind '${safeString(kind)}' at ${path} is not in CAM v0.1 set; defaulting to 'field-requirement'`,
  );
  return "field-requirement";
}
