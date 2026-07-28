/**
 * InteractionModel builder — a projection of AIM `interactionFlows`, per ADR-018.
 *
 * This builder authors nothing. Every screen, section and field binding it
 * emits has exactly one source element in the AIM; the only two things derived
 * here are `control` (a mechanical function of the entity field's declared type
 * and format, plus the placement's `mode`/`capture`) and `order` (array
 * position). If the AIM does not say it, the CAM does not contain it.
 *
 * Projection:
 *   flow.step   -> screen        `step.<slug>`      -> `screen.<slug>`
 *   step.group  -> section       `group.<slug>`     -> `section.<slug>`
 *   placement   -> fieldBinding  `placement.<slug>` -> `field-binding.<slug>`
 *   flow.actors -> screen.assignedTo
 *   step.intent -> screen.kind   (capture->form, review->review, browse->list,
 *                                 decide->detail, monitor->dashboard)
 *
 * Fallback. When the AIM carries no `interactionFlows` — legal at AIM v0.2,
 * illegal at v1.0 — this builder falls back to the pre-ADR-018 role x entity
 * cross-product so the pipeline still produces a schema-valid CAM. That
 * fallback is a guess, so it is made loud rather than silent:
 *   - `CAM_GEN_INTERACTION_FLOWS_MISSING` is emitted at severity `error`, and
 *   - the sub-model is stamped `origin: "generator-fallback"`, which the
 *     governance gate's accessibility check blocks outside a dev environment.
 * Guessing is not the problem. Unattributed guessing is.
 *
 * Control inference from AIM field.type (+ optional format), used only when the
 * placement does not declare `capture` and is not `mode: "read"`:
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

import { CAM_GEN_DIAGNOSTIC_CODES, type JsonObject } from "./types.js";
import type { DiagnosticCollector } from "./diagnostics.js";

/** AIM `step.intent` -> CAM `screen.kind`. Total over the AIM v0.2 enum. */
const INTENT_KIND_MAP: Readonly<Record<string, string>> = {
  capture: "form",
  review: "review",
  browse: "list",
  decide: "detail",
  monitor: "dashboard",
};

/** AIM `placement.capture` -> CAM `fieldBinding.control`. */
const CAPTURE_CONTROL_MAP: Readonly<Record<string, string>> = {
  text: "text",
  "long-text": "textarea",
  number: "number",
  money: "money",
  date: "date",
  datetime: "datetime",
  boolean: "boolean",
  choice: "select",
  file: "file-upload",
};

/** AIM `field.type` -> CAM `fieldBinding.control`. */
const TYPE_CONTROL_MAP: Readonly<Record<string, string>> = {
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

export function buildInteractionModel(
  aimRoles: readonly JsonObject[],
  aimEntities: readonly JsonObject[],
  aimInteractionFlows: readonly JsonObject[],
  subModelVersion: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  if (aimInteractionFlows.length === 0) {
    diagnostics.err(
      CAM_GEN_DIAGNOSTIC_CODES.INTERACTION_FLOWS_MISSING,
      "/interactionFlows",
      "AIM declares no interactionFlows. Per ADR-018 the InteractionModel is intent and must come from the AIM. " +
        "Falling back to a mechanical role x entity projection stamped origin 'generator-fallback'; " +
        "the governance gate blocks this outside a dev environment.",
    );
    return {
      version: subModelVersion,
      origin: "generator-fallback",
      screens: buildFallbackScreens(aimRoles, aimEntities),
    };
  }

  const fieldIndex = indexEntityFields(aimEntities);
  const screens: JsonObject[] = [];
  const origins = new Set<string>();

  for (const [flowIndex, flow] of aimInteractionFlows.entries()) {
    const origin = readString(flow["origin"]);
    if (origin !== undefined) origins.add(origin);
    const actors = readStringArray(flow["actors"]);
    const steps = readArray(flow["steps"]);
    for (const [stepIndex, step] of steps.entries()) {
      screens.push(
        buildScreen(
          step,
          actors,
          fieldIndex,
          diagnostics,
          `/interactionFlows/${String(flowIndex)}/steps/${String(stepIndex)}`,
        ),
      );
    }
  }

  return {
    version: subModelVersion,
    origin: narrowestOrigin(origins),
    screens,
  };
}

/**
 * The sub-model origin is the weakest claim any contributing flow makes, so a
 * single derived-default flow cannot hide behind a stated one.
 */
function narrowestOrigin(origins: ReadonlySet<string>): string {
  if (origins.has("derived-default")) return "derived-default";
  if (origins.has("agent-proposed")) return "agent-proposed";
  return "stated";
}

function buildScreen(
  step: JsonObject,
  actors: readonly string[],
  fieldIndex: ReadonlyMap<string, JsonObject>,
  diagnostics: DiagnosticCollector,
  path: string,
): JsonObject {
  const stepId = readString(step["id"]) ?? "step.unknown";
  const intent = readString(step["intent"]) ?? "capture";
  const groups = readArray(step["groups"]);

  const screen: Record<string, unknown> = {
    id: `screen.${stripKind(stepId)}`,
    title: readString(step["label"]) ?? stepId,
    kind: INTENT_KIND_MAP[intent] ?? "form",
    assignedTo: actors.length > 0 ? [...actors] : ["role.default"],
    sections: groups.map((group, i) =>
      buildSection(group, fieldIndex, diagnostics, `${path}/groups/${String(i)}`),
    ),
  };
  const entryWhen = readString(step["entryWhen"]);
  if (entryWhen !== undefined) screen["entryConditionRef"] = entryWhen;
  return screen as JsonObject;
}

function buildSection(
  group: JsonObject,
  fieldIndex: ReadonlyMap<string, JsonObject>,
  diagnostics: DiagnosticCollector,
  path: string,
): JsonObject {
  const groupId = readString(group["id"]) ?? "group.unknown";
  const placements = readArray(group["placements"]);

  const section: Record<string, unknown> = {
    id: `section.${stripKind(groupId)}`,
    fields: placements.map((placement, i) =>
      buildFieldBinding(placement, fieldIndex, diagnostics, `${path}/placements/${String(i)}`, i),
    ),
  };
  const label = readString(group["label"]);
  if (label !== undefined) section["title"] = label;
  const visibleWhen = readString(group["visibleWhen"]);
  if (visibleWhen !== undefined) section["visibleWhenRef"] = visibleWhen;
  return section as JsonObject;
}

function buildFieldBinding(
  placement: JsonObject,
  fieldIndex: ReadonlyMap<string, JsonObject>,
  diagnostics: DiagnosticCollector,
  path: string,
  index: number,
): JsonObject {
  const placementId = readString(placement["id"]) ?? `placement.unknown-${String(index)}`;
  const entityRef = readString(placement["entityRef"]) ?? "entity.unknown";
  const fieldRef = readString(placement["fieldRef"]) ?? `field${String(index)}`;
  const field = fieldIndex.get(`${entityRef}#${fieldRef}`);

  if (field === undefined) {
    diagnostics.err(
      CAM_GEN_DIAGNOSTIC_CODES.INTERACTION_FIELD_UNRESOLVED,
      path,
      `Placement ${placementId} references ${entityRef}.${fieldRef}, which no AIM entity declares. ` +
        "The binding is emitted with control 'text' so the CAM stays schema-valid, but the reference is broken.",
    );
  }

  const binding: Record<string, unknown> = {
    id: `field-binding.${stripKind(placementId)}`,
    entityRef,
    fieldRef,
    control: resolveControl(placement, field),
    order: (index + 1) * 10,
  };
  copyString(placement, "label", binding, "label");
  copyString(placement, "helpText", binding, "helpText");
  copyString(placement, "visibleWhen", binding, "visibleWhenRef");
  copyString(placement, "editableWhen", binding, "editableWhenRef");
  copyString(placement, "requiredWhen", binding, "requiredWhenRef");
  return binding as JsonObject;
}

/**
 * `mode` beats `capture` beats the entity field's declared shape. A read-only
 * placement is read-only whatever the field looks like.
 */
function resolveControl(placement: JsonObject, field: JsonObject | undefined): string {
  if (readString(placement["mode"]) === "read") return "readonly";
  const capture = readString(placement["capture"]);
  if (capture !== undefined) return CAPTURE_CONTROL_MAP[capture] ?? "text";
  return inferControl(field);
}

export function inferControl(field: JsonObject | undefined): string {
  if (field === undefined) return "text";
  const type = readString(field["type"]) ?? "";
  const format = readString(field["format"]) ?? "";
  if (type === "string" && format === "email") return "email";
  if (type === "string" && format.startsWith("phone")) return "phone";
  return TYPE_CONTROL_MAP[type] ?? "text";
}

/** `entity.customer#legalName` -> the AIM field object. */
function indexEntityFields(entities: readonly JsonObject[]): ReadonlyMap<string, JsonObject> {
  const index = new Map<string, JsonObject>();
  for (const entity of entities) {
    const entityId = readString(entity["id"]);
    if (entityId === undefined) continue;
    for (const field of readArray(entity["fields"])) {
      const fieldId = readString(field["id"]);
      if (fieldId === undefined) continue;
      index.set(`${entityId}#${fieldId}`, field);
    }
  }
  return index;
}

/* -------------------------------------------------------------------------- */
/* Fallback projection — pre-ADR-018 behaviour, retained only as a loud default */
/* -------------------------------------------------------------------------- */

function buildFallbackScreens(
  aimRoles: readonly JsonObject[],
  aimEntities: readonly JsonObject[],
): JsonObject[] {
  const roles =
    aimRoles.length > 0 ? aimRoles : [{ id: "role.default", description: "Default role" }];
  const entities = aimEntities.length > 0 ? aimEntities : [{ id: "entity.default", fields: [] }];
  return roles.map((role) => {
    const roleId = readString(role["id"]) ?? "role.default";
    const roleSlug = stripKind(roleId);
    return {
      id: `screen.${roleSlug}`,
      title: readString(role["description"]) ?? roleId,
      kind: "form",
      assignedTo: [roleId],
      sections: entities.map((entity) => {
        const entityId = readString(entity["id"]) ?? "entity.unknown";
        const entitySlug = stripKind(entityId);
        return {
          id: `section.${roleSlug}.${entitySlug}`,
          fields: readArray(entity["fields"]).map((field, i) => {
            const fieldRef = readString(field["id"]) ?? `field${String(i)}`;
            const binding: Record<string, unknown> = {
              id: `field-binding.${roleSlug}.${entitySlug}.${kebab(fieldRef)}`,
              entityRef: entityId,
              fieldRef,
              control: inferControl(field),
              order: (i + 1) * 10,
            };
            copyString(field, "label", binding, "label");
            return binding as JsonObject;
          }),
        } as JsonObject;
      }),
    } as JsonObject;
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Strip the leading `<kind>.` token: `placement.applicant.legal-name` -> `applicant.legal-name`. */
function stripKind(id: string): string {
  const dot = id.indexOf(".");
  return dot < 0 ? id : id.slice(dot + 1);
}

/** camelCase / PascalCase / snake_case -> kebab-case, keeping the ASCII lowercase alphabet. */
function kebab(input: string): string {
  return input
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function readArray(value: unknown): readonly JsonObject[] {
  return Array.isArray(value) ? (value as JsonObject[]) : [];
}

function copyString(
  source: JsonObject,
  sourceKey: string,
  target: Record<string, unknown>,
  targetKey: string,
): void {
  const value = readString(source[sourceKey]);
  if (value !== undefined) target[targetKey] = value;
}
