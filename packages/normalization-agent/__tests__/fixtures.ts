/**
 * Shared fixtures for normalization-agent tests.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

export const AIM_SCHEMA_PATH = resolve(
  REPO_ROOT,
  "docs",
  "schemas",
  "aim.v0.2.schema.json",
);

export const PROMPT_REGISTRY_PATH = resolve(
  REPO_ROOT,
  "packages",
  "prompt-template-registry",
  "prompts",
);

export const CUSTOMER_ONBOARDING_BIM_PATH = resolve(
  REPO_ROOT,
  "examples",
  "customer-onboarding",
  "bim.json",
);

export const CUSTOMER_ONBOARDING_AIM_PATH = resolve(
  REPO_ROOT,
  "examples",
  "customer-onboarding",
  "aim.json",
);

export function loadJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** Deep clone helper for mutating fixtures inside tests. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
