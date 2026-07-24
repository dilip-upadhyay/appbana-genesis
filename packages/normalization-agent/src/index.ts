/**
 * Public API for `@appbana/normalization-agent`.
 *
 * The Normalization Agent translates a Business Intent Model (BIM) into an
 * Application Intent Model (AIM) by invoking a structured-output AI adapter
 * against the versioned `prompt.normalization-agent.bim-to-aim` template. See
 * ADR-011 for the BIM \u2194 AIM contract and ADR-015 for the AI adapter interface.
 */

export {
  normalizeBim,
  findUnresolvedPaths,
  NormalizationAgentError,
} from "./agent.js";
export type { NormalizationAgentConfig } from "./agent.js";

export type {
  AimDocument,
  AimValidationError,
  AimValidationResult,
  AimValidator,
  BimDocument,
  NormalizeBimInput,
  NormalizeBimOutcome,
  NormalizeBimResult,
  NormalizeDiagnostic,
} from "./types.js";
export { UNRESOLVED_SENTINEL } from "./types.js";

export { canonicalizeJson, contentHash, sha256Hex } from "./hash.js";

export { createAjvAimValidator } from "./ajv-validator.js";
export type { CreateAjvAimValidatorOptions } from "./ajv-validator.js";
