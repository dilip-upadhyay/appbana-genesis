/**
 * `@appbana/canonical-application-generator`
 *
 * Deterministic AIM v0.1 -> CAM v0.1 generator. Public API: `generateCam` +
 * the types it consumes and returns.
 */

export { generateCam } from "./generate.js";
export {
  CAM_GEN_DIAGNOSTIC_CODES,
} from "./types.js";
export type {
  Json,
  JsonObject,
  AimDocument,
  GeneratorInfo,
  GenerateCamOptions,
  GenerateCamResult,
  CamGeneratorDiagnostic,
  CamGenDiagnosticCode,
} from "./types.js";
export { contentHash, canonicalizeJson, sha256Hex } from "./hash.js";
