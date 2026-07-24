/**
 * Registry validators.
 *
 * `validateRegistry` re-checks a hydrated registry (fast, in-memory) and
 * returns any structural problems. `validateProvenanceRefs` cross-checks a
 * list of historical `ProvenanceRefRecord`s against the current registry —
 * the sole way to prove that CI-time changes have not orphaned or mutated
 * a template that some past AI call still depends on.
 */

import type {
  PromptRegistry,
  ProvenanceRefRecord,
  RegistryProblem,
} from "./types.js";

/**
 * Idempotency check on an already-loaded registry. `loadRegistry` runs the
 * same checks; this function is here for callers that hold a `PromptRegistry`
 * and want to re-verify it (e.g. after mutating it in memory).
 */
export function validateRegistry(
  registry: PromptRegistry,
): readonly RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const seen = new Set<string>();
  for (const template of registry.templates.values()) {
    const key = `${template.ref}@${template.version}`;
    if (seen.has(key)) {
      problems.push({
        code: "DUPLICATE_ENTRY",
        message: `duplicate template entry ${key}`,
        ref: template.ref,
        version: template.version,
      });
    }
    seen.add(key);
  }
  return problems;
}

/**
 * Cross-check historical provenance references against the current registry.
 * A single missing or mutated template fails CI and prevents the registry
 * change from merging — the enforcement rule laid out in ADR-015.
 *
 * `refs` typically comes from an SQL query against the AI provenance store,
 * e.g. `SELECT DISTINCT promptTemplateRef, promptTemplateVersion, ...`.
 */
export function validateProvenanceRefs(
  registry: PromptRegistry,
  refs: readonly ProvenanceRefRecord[],
): readonly RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  for (const record of refs) {
    const key = `${record.ref}@${record.version}`;
    const live = registry.templates.get(key);
    if (live === undefined) {
      problems.push({
        code: "PROVENANCE_REF_MISSING",
        message: `provenance references ${key} but the current registry does not contain it — deleting a referenced template is FORBIDDEN`,
        ref: record.ref,
        version: record.version,
      });
      continue;
    }
    if (record.templateHash !== undefined && record.templateHash !== live.sha256) {
      problems.push({
        code: "PROVENANCE_HASH_MISMATCH",
        message: `provenance references ${key} with templateHash=${record.templateHash} but the live registry has sha256=${live.sha256} — mutating an existing version is FORBIDDEN, bump the version instead`,
        ref: record.ref,
        version: record.version,
        file: live.file,
      });
    }
  }
  return problems;
}
