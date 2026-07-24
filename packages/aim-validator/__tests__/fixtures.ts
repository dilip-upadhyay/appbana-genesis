/**
 * Shared fixtures for aim-validator tests.
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
  "aim.v0.1.schema.json",
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

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
