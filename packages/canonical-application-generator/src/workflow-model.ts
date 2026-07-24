/**
 * WorkflowModel builder: state machines with normalised transitions and effects.
 *
 * Transformations:
 *   - `guard: {ref: "rule.x"}` -> `guardRef: "rule.x"`
 *   - transition effect `{type: "emit-trace", eventType: "case.x"}`
 *     -> `{type: "emit-trace", eventKindRef: "event.case.x"}` (adds `event.` prefix)
 *   - transition effect `{type: "notify-applicant", template: "t"}`
 *     -> `{type: "notify", template: "t", recipients: ["role.applicant"]}`
 *   - transition effect `{type: "assign-reviewer", policy}` -> passthrough
 *   - transition effect `{type: "require-field", field}` -> passthrough
 *   - any other effect type is dropped with `EFFECT_UNMAPPED` warning
 *   - `sourceBimStage` / `sourceBimSection` annotations are dropped
 *
 * The generator also synthesises a default `assignmentPolicies` entry when any
 * transition uses the `assign-reviewer` effect with `policy: "round-robin"`.
 */

import { CAM_GEN_DIAGNOSTIC_CODES, type JsonObject } from "./types.js";
import type { DiagnosticCollector } from "./diagnostics.js";

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const CAM_STATE_KEYS_ALLOWED = new Set(["id", "assignedTo", "terminal"]);
const CAM_TRANSITION_KEYS_ALLOWED = new Set([
  "id",
  "from",
  "to",
  "triggeredBy",
  "allowedRoles",
  "guardRef",
  "effects",
]);
const CAM_SM_KEYS_ALLOWED = new Set([
  "id",
  "entityRef",
  "fieldRef",
  "initialState",
  "terminalStates",
  "states",
  "transitions",
  "retention",
]);

export interface WorkflowBuildOutput {
  readonly model: JsonObject;
  /** Distinct event-kind ids surfaced by `emit-trace` effects (with `event.` prefix). */
  readonly emittedEventKinds: readonly string[];
}

export function buildWorkflowModel(
  aimStateMachines: readonly JsonObject[],
  subModelVersion: string,
  diagnostics: DiagnosticCollector,
): WorkflowBuildOutput {
  const emittedEventKinds = new Set<string>();
  let usesRoundRobin = false;

  const stateMachines = aimStateMachines.map((sm, i) => {
    const smPath = `/stateMachines/${i}`;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sm)) {
      if (k === "states") continue;
      if (k === "transitions") continue;
      if (CAM_SM_KEYS_ALLOWED.has(k)) out[k] = v;
    }
    const states = (Array.isArray(sm["states"]) ? sm["states"] : []).map(
      (s) => filterKeys(s as JsonObject, CAM_STATE_KEYS_ALLOWED),
    );
    const transitions = (Array.isArray(sm["transitions"]) ? sm["transitions"] : []).map(
      (t, j) => {
        const transformed = transformTransition(
          t as JsonObject,
          `${smPath}/transitions/${j}`,
          diagnostics,
        );
        for (const kind of transformed.emittedEventKinds) emittedEventKinds.add(kind);
        if (transformed.usesRoundRobin) usesRoundRobin = true;
        return transformed.transition;
      },
    );
    out["states"] = states;
    out["transitions"] = transitions;
    return out as JsonObject;
  });

  const model: Record<string, unknown> = {
    version: subModelVersion,
    stateMachines,
  };
  if (usesRoundRobin) {
    model["assignmentPolicies"] = [
      {
        id: "assignment.reviewer.round-robin",
        targetRole: "role.reviewer",
        policy: "round-robin",
      },
    ];
  }

  return {
    model: model as JsonObject,
    emittedEventKinds: [...emittedEventKinds].sort(compareStrings),
  };
}

interface TransformedTransition {
  readonly transition: JsonObject;
  readonly emittedEventKinds: readonly string[];
  readonly usesRoundRobin: boolean;
}

function transformTransition(
  transition: JsonObject,
  path: string,
  diagnostics: DiagnosticCollector,
): TransformedTransition {
  const out: Record<string, unknown> = {};
  const emittedEventKinds: string[] = [];
  let usesRoundRobin = false;

  for (const [k, v] of Object.entries(transition)) {
    if (k === "guard") {
      const guardRef = extractGuardRef(v);
      if (guardRef !== undefined) out["guardRef"] = guardRef;
      continue;
    }
    if (k === "effects") continue; // handled below
    if (CAM_TRANSITION_KEYS_ALLOWED.has(k)) out[k] = v;
  }

  const rawEffects = Array.isArray(transition["effects"]) ? transition["effects"] : [];
  const effects: JsonObject[] = [];
  rawEffects.forEach((effect, i) => {
    const mapped = mapEffect(
      effect as JsonObject,
      `${path}/effects/${i}`,
      diagnostics,
    );
    if (mapped === undefined) return;
    effects.push(mapped);
    const type = mapped["type"];
    if (type === "emit-trace" && typeof mapped["eventKindRef"] === "string") {
      emittedEventKinds.push(mapped["eventKindRef"]);
    }
    if (type === "assign-reviewer" && mapped["policy"] === "round-robin") {
      usesRoundRobin = true;
    }
  });
  if (effects.length > 0) out["effects"] = effects;

  return { transition: out as JsonObject, emittedEventKinds, usesRoundRobin };
}

function extractGuardRef(guard: unknown): string | undefined {
  if (
    guard !== null &&
    typeof guard === "object" &&
    !Array.isArray(guard) &&
    typeof (guard as Record<string, unknown>)["ref"] === "string"
  ) {
    return (guard as Record<string, unknown>)["ref"] as string;
  }
  return undefined;
}

function mapEffect(
  effect: JsonObject,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject | undefined {
  const type = effect["type"];
  if (typeof type !== "string") {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EFFECT_UNMAPPED,
      path,
      `effect at ${path} is missing a string 'type'; dropping`,
    );
    return undefined;
  }
  switch (type) {
    case "emit-trace":
      return mapEmitTrace(effect, path, diagnostics);
    case "notify-applicant":
      return mapNotifyApplicant(effect, path, diagnostics);
    case "notify":
      return mapNotify(effect, path, diagnostics);
    case "assign-reviewer":
      return mapAssignReviewer(effect, path, diagnostics);
    case "require-field":
      return mapRequireField(effect, path, diagnostics);
    default:
      diagnostics.warn(
        CAM_GEN_DIAGNOSTIC_CODES.EFFECT_UNMAPPED,
        path,
        `effect type '${type}' at ${path} is not in CAM v0.1 effect set; dropping`,
      );
      return undefined;
  }
}

function mapEmitTrace(
  effect: JsonObject,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject | undefined {
  const eventType = effect["eventType"];
  if (typeof eventType !== "string") {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EFFECT_UNMAPPED,
      path,
      `emit-trace at ${path} is missing 'eventType'; dropping`,
    );
    return undefined;
  }
  const eventKindRef = eventType.startsWith("event.") ? eventType : `event.${eventType}`;
  return { type: "emit-trace", eventKindRef };
}

function mapNotifyApplicant(
  effect: JsonObject,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject | undefined {
  const template = effect["template"];
  if (typeof template !== "string") {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EFFECT_UNMAPPED,
      path,
      `notify-applicant at ${path} is missing 'template'; dropping`,
    );
    return undefined;
  }
  return { type: "notify", template, recipients: ["role.applicant"] };
}

function mapNotify(
  effect: JsonObject,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject | undefined {
  const template = effect["template"];
  const recipients = effect["recipients"];
  if (typeof template !== "string" || !Array.isArray(recipients) || recipients.length === 0) {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EFFECT_UNMAPPED,
      path,
      `notify at ${path} requires 'template' and non-empty 'recipients[]'; dropping`,
    );
    return undefined;
  }
  return { type: "notify", template, recipients };
}

function mapAssignReviewer(
  effect: JsonObject,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject | undefined {
  const policy = effect["policy"];
  if (policy !== "round-robin" && policy !== "workload-based" && policy !== "manual") {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EFFECT_UNMAPPED,
      path,
      `assign-reviewer at ${path} requires policy in {round-robin, workload-based, manual}; dropping`,
    );
    return undefined;
  }
  return { type: "assign-reviewer", policy };
}

function mapRequireField(
  effect: JsonObject,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject | undefined {
  const field = effect["field"];
  if (typeof field !== "string") {
    diagnostics.warn(
      CAM_GEN_DIAGNOSTIC_CODES.EFFECT_UNMAPPED,
      path,
      `require-field at ${path} requires 'field'; dropping`,
    );
    return undefined;
  }
  return { type: "require-field", field };
}

function filterKeys(obj: JsonObject, allowed: ReadonlySet<string>): JsonObject {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out as JsonObject;
}
