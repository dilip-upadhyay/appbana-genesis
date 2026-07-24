/**
 * DeploymentModel — v0.1 structural stub. Phase 5 fills topology + resources.
 * Emits `topology.mode = "unspecified"` by default so tenants can override
 * without a schema break.
 */

import type { JsonObject } from "./types.js";

export function buildDeploymentModel(subModelVersion: string): JsonObject {
  return {
    version: subModelVersion,
    topology: { mode: "unspecified" },
  };
}
