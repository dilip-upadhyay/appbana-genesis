/**
 * OperationModel builder.
 *
 * Transformations:
 *   - keep: id, version, allowedRoles, idempotency, sideEffects, auditEvent
 *   - `guard: {ref: "rule.x"}` -> `guardRef: "rule.x"`
 *   - drop: `sourceBimAction`
 *   - synthesise required `adapter` from sideEffects (see `inferAdapter`).
 *
 * Adapter inference (deterministic, first match wins):
 *   1. sideEffects includes `object-store:put`         -> {storage, "object-store:default"}
 *   2. sideEffects includes `notify`                   -> {notification, "notification:default"}
 *   3. sideEffects includes any `transition:*`         -> {internal, "kernel:state-transition"}
 *   4. sideEffects includes `persist` (and only data)  -> {data, "entity.<inferred>"}
 *   5. sideEffects empty AND idempotency.kind = pure   -> {internal, "kernel:pure-eval"}
 *   6. fallback                                        -> {internal, "kernel:generic"}
 */

import { CAM_GEN_DIAGNOSTIC_CODES, type JsonObject } from "./types.js";
import type { DiagnosticCollector } from "./diagnostics.js";

const CAM_OP_KEYS_ALLOWED = new Set([
  "id",
  "version",
  "allowedRoles",
  "idempotency",
  "retryPolicy",
  "guardRef",
  "sideEffects",
  "auditEvent",
  "adapter",
  "errorTaxonomy",
]);

export function buildOperationModel(
  aimOperations: readonly JsonObject[],
  aimEntities: readonly JsonObject[],
  subModelVersion: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  const primaryEntityId = inferPrimaryEntityId(aimEntities);
  return {
    version: subModelVersion,
    operations: aimOperations.map((op, i) =>
      transformOperation(op, i, primaryEntityId, diagnostics),
    ),
  };
}

function transformOperation(
  op: JsonObject,
  index: number,
  primaryEntityId: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  const path = `/operations/${index}`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(op)) {
    if (k === "guard") {
      if (
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        typeof (v as Record<string, unknown>)["ref"] === "string"
      ) {
        out["guardRef"] = (v as Record<string, unknown>)["ref"];
      }
      continue;
    }
    if (CAM_OP_KEYS_ALLOWED.has(k)) out[k] = v;
  }
  out["adapter"] = inferAdapter(op, primaryEntityId, path, diagnostics);
  return out as JsonObject;
}

function inferAdapter(
  op: JsonObject,
  primaryEntityId: string,
  path: string,
  diagnostics: DiagnosticCollector,
): JsonObject {
  const sideEffects = Array.isArray(op["sideEffects"]) ? (op["sideEffects"] as unknown[]) : [];
  const strEffects = sideEffects.filter((e): e is string => typeof e === "string");
  const has = (needle: string): boolean => strEffects.includes(needle);
  const hasTransition = strEffects.some((e) => e.startsWith("transition:"));
  const idempotency = op["idempotency"];
  const idempotencyKind =
    idempotency !== null &&
    typeof idempotency === "object" &&
    !Array.isArray(idempotency)
      ? (idempotency as Record<string, unknown>)["kind"]
      : undefined;

  let adapter: JsonObject;
  if (has("object-store:put")) {
    adapter = { kind: "storage", binding: "object-store:default" };
  } else if (has("notify")) {
    adapter = { kind: "notification", binding: "notification:default" };
  } else if (hasTransition) {
    adapter = { kind: "internal", binding: "kernel:state-transition" };
  } else if (has("persist")) {
    adapter = { kind: "data", binding: primaryEntityId };
  } else if (strEffects.length === 0 && idempotencyKind === "pure") {
    adapter = { kind: "internal", binding: "kernel:pure-eval" };
  } else {
    adapter = { kind: "internal", binding: "kernel:generic" };
  }
  diagnostics.info(
    CAM_GEN_DIAGNOSTIC_CODES.ADAPTER_INFERRED,
    path,
    `operation adapter inferred as ${JSON.stringify(adapter)}`,
  );
  return adapter;
}

function inferPrimaryEntityId(entities: readonly JsonObject[]): string {
  const first = entities[0];
  if (first !== undefined && typeof first["id"] === "string") return first["id"];
  return "entity.unknown";
}
