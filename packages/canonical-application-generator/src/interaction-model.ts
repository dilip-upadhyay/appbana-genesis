/**
 * InteractionModel builder.
 *
 * Generates one `screen` per AIM role, preserving AIM role order. Each screen
 * exposes one `section` per entity (again preserving AIM order), and one
 * `fieldBinding` per entity field (again preserving order, `order = i * 10`).
 *
 * Deterministic id shapes:
 *   - screen        : `screen.<role-slug>`
 *   - section       : `section.<screen-slug>.<entity-slug>`
 *   - fieldBinding  : `field-binding.<screen-slug>.<entity-slug>.<field-name>`
 *
 * Control inference from AIM field.type (+ optional format):
 *   string(email)    -> email
 *   string(phone-*)  -> phone
 *   string           -> text
 *   text             -> textarea
 *   integer|decimal  -> number
 *   money            -> money
 *   boolean          -> boolean
 *   date             -> date
 *   datetime         -> datetime
 *   enum             -> select
 *   reference        -> readonly
 *   file             -> file-upload
 *   default          -> text
 */

import type { JsonObject } from "./types.js";
import type { DiagnosticCollector } from "./diagnostics.js";

export function buildInteractionModel(
  aimRoles: readonly JsonObject[],
  aimEntities: readonly JsonObject[],
  subModelVersion: string,
  _diagnostics: DiagnosticCollector,
): JsonObject {
  const roleList = aimRoles.length > 0 ? aimRoles : [{ id: "role.default", description: "Default role" }];
  const screens = roleList.map((role) => buildScreen(role as JsonObject, aimEntities));
  return { version: subModelVersion, screens };
}

function buildScreen(role: JsonObject, entities: readonly JsonObject[]): JsonObject {
  const roleId = typeof role["id"] === "string" ? role["id"] : "role.default";
  const roleSlug = stripPrefix(roleId, "role.");
  const screenId = `screen.${roleSlug}`;
  const title =
    typeof role["description"] === "string" && role["description"].length > 0
      ? role["description"]
      : roleId;
  const entityList = entities.length > 0 ? entities : [{ id: "entity.default", fields: [] }];
  const sections = entityList.map((e) => buildSection(e as JsonObject, roleSlug));
  return {
    id: screenId,
    title,
    kind: "form",
    assignedTo: [roleId],
    sections,
  };
}

function buildSection(entity: JsonObject, roleSlug: string): JsonObject {
  const entityId = typeof entity["id"] === "string" ? entity["id"] : "entity.unknown";
  const entitySlug = stripPrefix(entityId, "entity.");
  const sectionId = `section.${roleSlug}.${entitySlug}`;
  const fields = Array.isArray(entity["fields"]) ? (entity["fields"] as JsonObject[]) : [];
  const bindings = fields.map((f, i) => buildFieldBinding(f, entityId, roleSlug, entitySlug, i));
  return { id: sectionId, fields: bindings };
}

function buildFieldBinding(
  field: JsonObject,
  entityId: string,
  roleSlug: string,
  entitySlug: string,
  index: number,
): JsonObject {
  const fieldRef = typeof field["id"] === "string" ? field["id"] : `field${index}`;
  const control = inferControl(field);
  const binding: Record<string, unknown> = {
    id: `field-binding.${roleSlug}.${entitySlug}.${kebab(fieldRef)}`,
    entityRef: entityId,
    fieldRef,
    control,
    order: index * 10,
  };
  if (typeof field["label"] === "string") binding["label"] = field["label"];
  return binding as JsonObject;
}

/** camelCase / PascalCase / snake_case -> kebab-case, keeping the ASCII lowercase alphabet. */
function kebab(input: string): string {
  return input
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();
}

function inferControl(field: JsonObject): string {
  const type = typeof field["type"] === "string" ? field["type"] : "";
  const format = typeof field["format"] === "string" ? field["format"] : "";
  if (type === "string" && format === "email") return "email";
  if (type === "string" && format.startsWith("phone")) return "phone";
  return typeControlMap[type] ?? "text";
}

const typeControlMap: Readonly<Record<string, string>> = {
  string: "text",
  text: "textarea",
  integer: "number",
  decimal: "number",
  money: "money",
  boolean: "boolean",
  date: "date",
  datetime: "datetime",
  enum: "select",
  reference: "readonly",
  file: "file-upload",
};

function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}
