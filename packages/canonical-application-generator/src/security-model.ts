/**
 * SecurityModel builder.
 *
 * Roles are stripped down to `roleDef` shape (drops sourcePersonaName, approvalAuthority).
 * FieldAbacPolicies are synthesised from:
 *   - entity field `visibility.allowRoles` / `visibility.denyRoles`
 *   - `kind:"field-visibility"` rules that carry `target` + `allowRoles`/`denyRoles`
 * DataClassifications: emit one default policy per distinct classification observed on fields.
 */

import type { JsonObject } from "./types.js";
import type { DiagnosticCollector } from "./diagnostics.js";

const CAM_ROLE_KEYS_ALLOWED = new Set(["id", "description", "trust", "canAssumeAny", "readOnly"]);

const CLASSIFICATIONS = new Set([
  "public",
  "internal",
  "confidential",
  "pii",
  "sensitive-pii",
]);

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function buildSecurityModel(
  aimRoles: readonly JsonObject[],
  aimEntities: readonly JsonObject[],
  aimRules: readonly JsonObject[],
  subModelVersion: string,
  _diagnostics: DiagnosticCollector,
): JsonObject {
  const roles = aimRoles.map((r) => filterKeys(r, CAM_ROLE_KEYS_ALLOWED));
  const fieldAbacPolicies = [
    ...abacPoliciesFromEntities(aimEntities),
    ...abacPoliciesFromRules(aimRules),
  ];
  const dataClassifications = buildDataClassifications(aimEntities);
  return {
    version: subModelVersion,
    roles,
    fieldAbacPolicies,
    dataClassifications,
  };
}

function abacPoliciesFromEntities(entities: readonly JsonObject[]): JsonObject[] {
  const out: JsonObject[] = [];
  for (const entity of entities) {
    const entityId = typeof entity["id"] === "string" ? entity["id"] : "entity.unknown";
    const fields = Array.isArray(entity["fields"]) ? (entity["fields"] as JsonObject[]) : [];
    for (const field of fields) {
      const policy = policyForField(entityId, field);
      if (policy !== undefined) out.push(policy);
    }
  }
  return out;
}

function policyForField(entityId: string, field: JsonObject): JsonObject | undefined {
  const visibility = field["visibility"];
  if (visibility === null || typeof visibility !== "object" || Array.isArray(visibility)) return undefined;
  const vObj = visibility as Record<string, unknown>;
  const allow = Array.isArray(vObj["allowRoles"]) ? vObj["allowRoles"] : undefined;
  const deny = Array.isArray(vObj["denyRoles"]) ? vObj["denyRoles"] : undefined;
  if (allow === undefined && deny === undefined) return undefined;
  const fieldName = typeof field["id"] === "string" ? field["id"] : "unknown";
  const policy: Record<string, unknown> = {
    id: `abac.${stripEntityPrefix(entityId)}.${kebab(fieldName)}`,
    targets: [{ entity: entityId, field: fieldName }],
  };
  if (allow !== undefined) policy["allowRoles"] = allow;
  if (deny !== undefined) policy["denyRoles"] = deny;
  return policy as JsonObject;
}

function kebab(input: string): string {
  return input
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();
}

function abacPoliciesFromRules(rules: readonly JsonObject[]): JsonObject[] {
  const out: JsonObject[] = [];
  for (const rule of rules) {
    if (rule["kind"] !== "field-visibility") continue;
    const ruleId = typeof rule["id"] === "string" ? rule["id"] : "rule.unknown";
    const targets = collectRuleTargets(rule);
    if (targets.length === 0) continue;
    const allow = Array.isArray(rule["allowRoles"]) ? rule["allowRoles"] : undefined;
    const deny = Array.isArray(rule["denyRoles"]) ? rule["denyRoles"] : undefined;
    const policy: Record<string, unknown> = {
      id: `abac.${stripRulePrefix(ruleId)}`,
      targets,
      conditionRef: ruleId,
    };
    if (allow !== undefined) policy["allowRoles"] = allow;
    if (deny !== undefined) policy["denyRoles"] = deny;
    out.push(policy as JsonObject);
  }
  return out;
}

function collectRuleTargets(rule: JsonObject): JsonObject[] {
  const collected: JsonObject[] = [];
  const target = rule["target"];
  if (isTargetObject(target)) collected.push({ entity: target.entity, field: target.field });
  const targets = rule["targets"];
  if (Array.isArray(targets)) {
    for (const t of targets) {
      if (isTargetObject(t)) collected.push({ entity: t.entity, field: t.field });
    }
  }
  return collected;
}

function isTargetObject(v: unknown): v is { entity: string; field: string } {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  return typeof rec["entity"] === "string" && typeof rec["field"] === "string";
}

function buildDataClassifications(entities: readonly JsonObject[]): JsonObject[] {
  const seen = new Set<string>();
  for (const entity of entities) {
    const fields = Array.isArray(entity["fields"]) ? (entity["fields"] as JsonObject[]) : [];
    for (const field of fields) {
      const cls = field["classification"];
      if (typeof cls === "string" && CLASSIFICATIONS.has(cls)) seen.add(cls);
    }
  }
  seen.add("internal"); // guarantee at least one classification per schema minItems:1
  return [...seen].sort(compareStrings).map(defaultPolicyFor);
}

function defaultPolicyFor(classification: string): JsonObject {
  const policy: Record<string, unknown> = {};
  const preset = policyPresets[classification] ?? policyPresets["confidential"]!;
  policy["maskInLogs"] = preset.maskInLogs;
  policy["maskInUi"] = preset.maskInUi;
  policy["encryptionAtRest"] = preset.encryptionAtRest;
  policy["encryptionInTransit"] = preset.encryptionInTransit;
  return { classification, policy } as JsonObject;
}

interface PolicyPreset {
  readonly maskInLogs: boolean;
  readonly maskInUi: string;
  readonly encryptionAtRest: string;
  readonly encryptionInTransit: string;
}

const policyPresets: Readonly<Record<string, PolicyPreset>> = {
  public: {
    maskInLogs: false,
    maskInUi: "none",
    encryptionAtRest: "none",
    encryptionInTransit: "TLS-1.2+",
  },
  internal: {
    maskInLogs: false,
    maskInUi: "none",
    encryptionAtRest: "AES-256",
    encryptionInTransit: "TLS-1.2+",
  },
  confidential: {
    maskInLogs: true,
    maskInUi: "none",
    encryptionAtRest: "AES-256",
    encryptionInTransit: "TLS-1.2+",
  },
  pii: {
    maskInLogs: true,
    maskInUi: "last4-only",
    encryptionAtRest: "AES-256",
    encryptionInTransit: "TLS-1.2+",
  },
  "sensitive-pii": {
    maskInLogs: true,
    maskInUi: "full-mask",
    encryptionAtRest: "AES-256",
    encryptionInTransit: "TLS-1.3",
  },
};

function stripEntityPrefix(id: string): string {
  return id.startsWith("entity.") ? id.slice("entity.".length) : id;
}

function stripRulePrefix(id: string): string {
  return id.startsWith("rule.") ? id.slice("rule.".length) : id;
}

function filterKeys(obj: JsonObject, allowed: ReadonlySet<string>): JsonObject {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out as JsonObject;
}
