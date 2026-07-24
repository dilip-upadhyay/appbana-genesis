/**
 * Public API for `@appbana/aim-validator`.
 */

export { validateAim } from "./validate.js";
export { collectSymbolTable } from "./symbols.js";
export { resolveReferences } from "./references.js";
export { compileSchemaValidator } from "./schema.js";
export type { CompiledSchemaValidator } from "./schema.js";
export { createNormalizationAgentValidator } from "./adapter.js";
export { DEFAULT_AIM_REFERENCE_RULES } from "./ref-rules.js";

export type {
  AimDocument,
  AimDuplicateIdError,
  AimReferenceError,
  AimReferenceRule,
  AimSchemaValidationError,
  AimSymbol,
  AimSymbolKind,
  AimSymbolTable,
  AimValidationReport,
  ValidateAimOptions,
} from "./types.js";
