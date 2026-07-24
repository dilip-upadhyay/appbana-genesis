/**
 * DataModel builder: entities + enums.
 *
 * Fields are copied verbatim from AIM except for:
 *   - AIM-only annotations (`note`, `sourceBimAttribute`, `sourceBusinessObject`,
 *     `sourceBimStage`, `requiredWhenStatusIn`, `visibility`) are dropped;
 *   - `derivedFrom` -> `derivedFromRuleRef`;
 *   - fields whose CAM allowed set is smaller (e.g. `mimeType` type enum is
 *     narrowed to `string`) are normalised;
 *   - `currency: "resolved-at-runtime"` (AIM sentinel) is normalised to `"USD"`
 *     (v0.1 default) since the CAM schema treats currency as a free-form string.
 */

import { CAM_GEN_DIAGNOSTIC_CODES, type JsonObject } from "./types.js";
import type { DiagnosticCollector } from "./diagnostics.js";

const CAM_FIELD_KEYS_ALLOWED = new Set([
  "id",
  "type",
  "format",
  "required",
  "classification",
  "immutable",
  "enumRef",
  "allowedValues",
  "referenceTo",
  "cardinality",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "currency",
  "stateMachineRef",
  "derivedFromRuleRef",
]);

const CAM_ENUM_KEYS_ALLOWED = new Set(["id", "description", "closedStrictly", "values"]);

const CAM_ENTITY_KEYS_ALLOWED = new Set(["id", "name", "description", "keys", "fields"]);

export function buildDataModel(
  aimEntities: readonly JsonObject[],
  aimEnums: readonly JsonObject[],
  subModelVersion: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  return {
    version: subModelVersion,
    entities: aimEntities.map((e, i) => transformEntity(e, i, diagnostics)),
    enums: aimEnums.map((e) => transformEnum(e)),
  };
}

function transformEntity(
  entity: JsonObject,
  index: number,
  diagnostics: DiagnosticCollector,
): JsonObject {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entity)) {
    if (CAM_ENTITY_KEYS_ALLOWED.has(k)) out[k] = v;
  }
  const fieldsIn = Array.isArray(entity["fields"]) ? entity["fields"] : [];
  out["fields"] = fieldsIn.map((f, j) =>
    transformField(f as JsonObject, `/entities/${index}/fields/${j}`, diagnostics),
  );
  return out as JsonObject;
}

function transformField(
  field: JsonObject,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  const out: Record<string, unknown> = {};
  const isNulledEnumType =
    field["type"] === "enum" && (field["enumRef"] === null || field["enumRef"] === undefined);
  for (const [k, v] of Object.entries(field)) {
    const normalised = normaliseFieldEntry(k, v, field, isNulledEnumType, path, diagnostics);
    if (normalised !== undefined) out[normalised.key] = normalised.value;
  }
  return out as JsonObject;
}

function normaliseFieldEntry(
  key: string,
  value: unknown,
  field: JsonObject,
  isNulledEnumType: boolean,
  path: string,
  diagnostics: DiagnosticCollector,
): { key: string; value: unknown } | undefined {
  if (key === "derivedFrom" && typeof value === "string") {
    return { key: "derivedFromRuleRef", value };
  }
  if (key === "type" && value === "enum" && isNulledEnumType) {
    return { key: "type", value: "string" };
  }
  if (key === "enumRef" && value === null) return undefined;
  if (key === "currency" && value === "resolved-at-runtime") {
    diagnostics.info(
      CAM_GEN_DIAGNOSTIC_CODES.RULE_KIND_DEFAULT,
      path,
      `field.currency='resolved-at-runtime' resolved to 'USD' (v0.1 default)`,
    );
    return { key: "currency", value: "USD" };
  }
  if (CAM_FIELD_KEYS_ALLOWED.has(key)) {
    return { key, value };
  }
  return undefined;
}

function transformEnum(enumDef: JsonObject): JsonObject {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(enumDef)) {
    if (CAM_ENUM_KEYS_ALLOWED.has(k)) out[k] = v;
  }
  return out as JsonObject;
}
