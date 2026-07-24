/**
 * ObservabilityModel builder.
 *
 * `traceEventKinds` is the sorted union of:
 *   - every distinct `emit-trace` effect `eventKindRef` surfaced by the workflow builder
 *   - every operation `auditEvent` (prefixed with `event.` if not already)
 *
 * `producedBy` is inferred deterministically:
 *   - state-machine-sourced events -> `["runtime-workflow"]`
 *   - operation-sourced events     -> `["runtime-operations"]`
 *   - both                         -> `["runtime-operations","runtime-workflow"]`
 */

import type { JsonObject } from "./types.js";
import type { DiagnosticCollector } from "./diagnostics.js";

const PREFIX = "event.";

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function buildObservabilityModel(
  workflowEventKinds: readonly string[],
  aimOperations: readonly JsonObject[],
  subModelVersion: string,
  _diagnostics: DiagnosticCollector,
): JsonObject {
  const workflowSet = new Set(workflowEventKinds);
  const operationSet = new Set<string>();
  for (const op of aimOperations) {
    const audit = op["auditEvent"];
    if (typeof audit !== "string") continue;
    operationSet.add(audit.startsWith(PREFIX) ? audit : `${PREFIX}${audit}`);
  }
  const union = new Set<string>([...workflowSet, ...operationSet]);
  if (union.size === 0) {
    // Guarantee schema minItems:1
    union.add("event.app.started");
    workflowSet.add("event.app.started");
  }
  const traceEventKinds = [...union].sort(compareStrings).map((id) => {
    const producedBy: string[] = [];
    if (operationSet.has(id)) producedBy.push("runtime-operations");
    if (workflowSet.has(id)) producedBy.push("runtime-workflow");
    if (producedBy.length === 0) producedBy.push("runtime-observability");
    return { id, producedBy } as JsonObject;
  });
  return { version: subModelVersion, traceEventKinds };
}
