import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo-root-relative path to the shipped Customer Onboarding AIM. */
export const AIM_PATH = resolve(here, "../../../examples/customer-onboarding/aim.json");

/**
 * Repo-root-relative path to the shipped, hand-authored Customer Onboarding CAM.
 *
 * This artifact is a Phase 0 design seed, not generator output — its
 * `metadata.generator.name` is literally `"hand-authored"`. It is the reference
 * the deterministic generator must eventually reproduce. See `roundtrip.test.ts`
 * for the invariant that is actually enforced today.
 */
export const CAM_PATH = resolve(here, "../../../examples/customer-onboarding/cam.json");

/** Repo-root-relative path to the shipped CAM v0.2 JSON Schema. */
export const CAM_SCHEMA_PATH = resolve(here, "../../../docs/schemas/cam.v0.2.schema.json");

/** Repo-root-relative path to the shipped AIM v0.2 JSON Schema. */
export const AIM_SCHEMA_PATH = resolve(here, "../../../docs/schemas/aim.v0.2.schema.json");

/** Read + parse a JSON file. */
export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Shared generator options with a fixed `generatedAt` so tests are deterministic. */
export const FIXED_GENERATED_AT = "2026-07-25T00:00:00Z";

export const FIXED_GENERATOR = {
  name: "@appbana/canonical-application-generator",
  version: "0.1.0",
};

export const FIXED_AIM_CONTENT_HASH =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";
