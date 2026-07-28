// Shared test fixtures — loads the shipped CAM schema + example CAM + example
// Operation Contract from the workspace, without any package-local copies.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

export const CAM_SCHEMA_PATH = resolve(REPO_ROOT, "docs/schemas/cam.v0.2.schema.json");
export const CAM_EXAMPLE_PATH = resolve(REPO_ROOT, "examples/customer-onboarding/cam.json");
export const OP_CONTRACT_EXAMPLE_PATH = resolve(
  REPO_ROOT,
  "examples/customer-onboarding/operation-contracts/customer.submit-onboarding.v1.json",
);

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const FIXED_TIMESTAMPS: readonly string[] = [
  "2026-07-25T10:00:00.000Z",
  "2026-07-25T10:00:00.100Z",
  "2026-07-25T10:00:00.200Z",
  "2026-07-25T10:00:00.300Z",
  "2026-07-25T10:00:00.400Z",
  "2026-07-25T10:00:00.500Z",
];

/** Deterministic monotonic clock. Cycles through FIXED_TIMESTAMPS. */
export function makeClock(): () => string {
  let i = 0;
  return () => FIXED_TIMESTAMPS[Math.min(i++, FIXED_TIMESTAMPS.length - 1)]!;
}
