/**
 * IntegrationModel — v0.1 structural stub. Phase 3 fills endpoints/message formats.
 */

import type { JsonObject } from "./types.js";

export function buildIntegrationModel(subModelVersion: string): JsonObject {
  return { version: subModelVersion };
}
