// @appbana/engine-contract — the closed EffectDescriptor union (ADR-013).
//
// Engines never apply side effects. `execute()` returns descriptors; the
// Platform Kernel applies them under Security/Policy Runtime supervision.
// This file is the single authoritative definition of what an effect may be.
//
// ADR-013 states the union is "stable-by-design, so adding new effect kinds is
// an ADR-worthy event". `EFFECT_TYPES` below is therefore exported and asserted
// against in tests: widening it without an ADR breaks a test on purpose.

import type { Json, JsonObject } from "./json.js";
import { jsonViolation } from "./json.js";

/**
 * Distributive `Omit`.
 *
 * ADR-013 writes the `schedule` effect's payload as
 * `Omit<EffectDescriptor, 'correlationId'>`. That is subtly wrong in
 * TypeScript: `Omit` on a union collapses to the union's *common* keys, so it
 * would erase `entity`, `eventName`, `channel`, and every other discriminated
 * member field, leaving only `{ type }`. Distributing over the union preserves
 * each member's shape, which is plainly the ADR's intent. Recorded as a
 * faithful-implementation deviation in docs/deviations.md (DEV-004).
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Persist an entity through the Data Runtime's adapters. */
export interface PersistEffect {
  readonly type: "persist";
  readonly entity: string;
  readonly operation: "upsert" | "delete";
  readonly data: Json;
  readonly correlationId: string;
}

/** Emit a domain event onto the platform event bus. */
export interface EmitEffect {
  readonly type: "emit";
  readonly eventName: string;
  readonly payload: Json;
  readonly correlationId: string;
}

/** Send a notification through a channel adapter. */
export interface NotifyEffect {
  readonly type: "notify";
  readonly channel: string;
  readonly templateId: string;
  readonly recipients: readonly string[];
  readonly correlationId: string;
}

/** Move an entity to a new state in a workflow state machine. */
export interface TransitionEffect {
  readonly type: "transition";
  readonly stateMachineId: string;
  readonly entityRef: string;
  readonly toState: string;
  readonly correlationId: string;
}

/**
 * Invoke a semantic operation. Per ADR-013 this is the *only* sanctioned way
 * for one engine to reach another engine's owned sub-model.
 */
export interface DispatchOperationEffect {
  readonly type: "dispatch-operation";
  readonly operationId: string;
  readonly input: Json;
  readonly correlationId: string;
}

/** Defer another effect until a wall-clock instant. */
export interface ScheduleEffect {
  readonly type: "schedule";
  /** ISO 8601 instant. Must come from `context.now()`, never a direct clock read. */
  readonly at: string;
  readonly effect: DistributiveOmit<
    | PersistEffect
    | EmitEffect
    | NotifyEffect
    | TransitionEffect
    | DispatchOperationEffect,
    "correlationId"
  >;
  readonly correlationId: string;
}

/**
 * The complete, closed set of side effects an engine may request.
 *
 * Note that `schedule` cannot nest a `schedule`. That is intentional: a
 * recursive schedule has no bounded expansion and cannot be statically audited
 * before the kernel applies it.
 */
export type EffectDescriptor =
  | PersistEffect
  | EmitEffect
  | NotifyEffect
  | TransitionEffect
  | DispatchOperationEffect
  | ScheduleEffect;

/** Every legal `type` discriminant. Widening this is an ADR-worthy event. */
export const EFFECT_TYPES = [
  "persist",
  "emit",
  "notify",
  "transition",
  "dispatch-operation",
  "schedule",
] as const;

export type EffectType = (typeof EFFECT_TYPES)[number];

const EFFECT_TYPE_SET: ReadonlySet<string> = new Set(EFFECT_TYPES);

/**
 * Validates that a value is a member of the closed `EffectDescriptor` union.
 *
 * Returns `undefined` when valid, or a human-readable reason when not. This
 * backs the "effect-audit test" mandated by ADR-013's Compliance section: for
 * every engine, CI asserts that all effects returned from `execute` are
 * members of the declared union — no ad-hoc effect shapes.
 */
export function effectViolation(value: unknown, path: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `${path} is not an object`;
  }

  const e = value as Record<string, unknown>;
  const type = e["type"];

  if (typeof type !== "string") return `${path}.type is missing or not a string`;
  if (!EFFECT_TYPE_SET.has(type)) {
    return `${path}.type "${type}" is not in the closed EffectDescriptor union (${EFFECT_TYPES.join(", ")}). Adding an effect kind requires an ADR (ADR-013).`;
  }

  if (typeof e["correlationId"] !== "string" || e["correlationId"] === "") {
    return `${path}.correlationId is missing or empty — every effect must link back to the trace event that produced it (ADR-013)`;
  }

  const jsonProblem = jsonViolation(value, path);
  if (jsonProblem !== undefined) return jsonProblem;

  switch (type as EffectType) {
    case "persist":
      if (!isNonEmptyString(e["entity"])) return `${path}.entity must be a non-empty string`;
      if (e["operation"] !== "upsert" && e["operation"] !== "delete") {
        return `${path}.operation must be "upsert" or "delete"`;
      }
      if (!("data" in e)) return `${path}.data is required`;
      return undefined;

    case "emit":
      if (!isNonEmptyString(e["eventName"])) return `${path}.eventName must be a non-empty string`;
      if (!("payload" in e)) return `${path}.payload is required`;
      return undefined;

    case "notify":
      if (!isNonEmptyString(e["channel"])) return `${path}.channel must be a non-empty string`;
      if (!isNonEmptyString(e["templateId"])) return `${path}.templateId must be a non-empty string`;
      if (!Array.isArray(e["recipients"]) || !e["recipients"].every(isNonEmptyString)) {
        return `${path}.recipients must be an array of non-empty strings`;
      }
      return undefined;

    case "transition":
      if (!isNonEmptyString(e["stateMachineId"])) return `${path}.stateMachineId must be a non-empty string`;
      if (!isNonEmptyString(e["entityRef"])) return `${path}.entityRef must be a non-empty string`;
      if (!isNonEmptyString(e["toState"])) return `${path}.toState must be a non-empty string`;
      return undefined;

    case "dispatch-operation":
      if (!isNonEmptyString(e["operationId"])) return `${path}.operationId must be a non-empty string`;
      if (!("input" in e)) return `${path}.input is required`;
      return undefined;

    case "schedule": {
      if (!isNonEmptyString(e["at"])) return `${path}.at must be a non-empty ISO 8601 string`;
      if (Number.isNaN(Date.parse(e["at"]))) return `${path}.at is not a parseable ISO 8601 instant`;

      const nested = e["effect"];
      if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
        return `${path}.effect is not an object`;
      }
      const nestedType = (nested as Record<string, unknown>)["type"];
      if (nestedType === "schedule") {
        return `${path}.effect may not itself be a "schedule" — recursive scheduling has no bounded expansion and cannot be statically audited`;
      }
      if ("correlationId" in nested) {
        return `${path}.effect must omit correlationId — the outer schedule effect carries it`;
      }
      // Re-validate the nested effect by borrowing the outer correlationId.
      return effectViolation(
        { ...(nested as Record<string, unknown>), correlationId: e["correlationId"] },
        `${path}.effect`,
      );
    }
  }
}

/** Type guard form of {@link effectViolation}. */
export function isEffectDescriptor(value: unknown): value is EffectDescriptor {
  return effectViolation(value, "$") === undefined;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Convenience: the payload an engine attaches when it wants a trace linkage. */
export type EffectPayload = JsonObject;
