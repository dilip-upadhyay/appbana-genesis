/**
 * Top-level `validateAim` orchestrator.
 *
 * Runs, in order:
 *   1. JSON-Schema validation (skipped if no schema is provided).
 *   2. Symbol-table collection (also produces duplicate-id errors).
 *   3. Cross-reference resolution against the symbol table.
 *
 * Every phase runs even if earlier ones report errors, so a single call
 * returns the whole picture instead of forcing callers to iterate.
 */

import { compileSchemaValidator } from "./schema.js";
import { collectSymbolTable } from "./symbols.js";
import { resolveReferences } from "./references.js";
import type {
  AimDocument,
  AimValidationReport,
  ValidateAimOptions,
} from "./types.js";

export function validateAim(
  aim: AimDocument,
  options: ValidateAimOptions = {},
): AimValidationReport {
  const schemaErrors = options.schema === undefined
    ? []
    : compileSchemaValidator(options.schema, options.ajvStrict ?? true)(aim);
  const symbols = collectSymbolTable(aim);
  const referenceErrors = resolveReferences(aim, symbols, {
    ...(options.referenceRules !== undefined ? { rules: options.referenceRules } : {}),
  });
  const duplicateIds = symbols.duplicates;

  const valid =
    schemaErrors.length === 0 &&
    referenceErrors.length === 0 &&
    duplicateIds.length === 0;

  const summary = renderSummary(schemaErrors.length, referenceErrors.length, duplicateIds.length);

  return {
    valid,
    schemaErrors,
    referenceErrors,
    duplicateIds,
    summary,
  };
}

function renderSummary(
  schemaCount: number,
  refCount: number,
  dupCount: number,
): string {
  if (schemaCount === 0 && refCount === 0 && dupCount === 0) return "AIM validated";
  const parts: string[] = [];
  if (schemaCount > 0) parts.push(`${schemaCount} schema error(s)`);
  if (refCount > 0) parts.push(`${refCount} unresolved reference(s)`);
  if (dupCount > 0) parts.push(`${dupCount} duplicate id(s)`);
  return `AIM invalid: ${parts.join(", ")}`;
}
