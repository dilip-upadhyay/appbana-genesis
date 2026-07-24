// @appbana/governance-validator — public barrel.
//
// ADR-017 Governance Publication Gate — Phase 1 subset.

export type {
  Json,
  JsonObject,
  Diagnostic,
  DeploymentMode,
  CamCriticality,
  GateCheck,
  GateCheckInput,
  GateCheckContext,
  GateCheckVerdict,
  GateWaiver,
  GateReport,
  MandatoryCheckId,
} from "./types.js";

export { MANDATORY_CHECK_IDS, NON_WAIVABLE_CHECK_IDS } from "./types.js";

export {
  canonicalizeJson,
  canonicalizeJsonString,
  sha256Hex,
  contentHash,
  canonicalReportBytes,
  reportContentHash,
} from "./canonical.js";

export {
  assertWaiverAdmissible,
  waiverActiveAt,
  WaiverForbiddenError,
  WaiverInvalidError,
} from "./waiver.js";

export { GovernanceGate, GateNotReadyError, serializeReport } from "./gate.js";
export type { EvaluateOptions, GovernanceGateOptions } from "./gate.js";

export { buildDefaultGate } from "./default-gate.js";

// Real Phase 1 checks
export {
  schemaValidationCheck,
  SCHEMA_VALIDATION_ID,
  SCHEMA_VALIDATION_VERSION,
  SCHEMA_VALIDATION_FAILURE_CODES,
} from "./checks/schema-validation.js";
export type { SchemaValidationFailureCode } from "./checks/schema-validation.js";

export {
  operationContractValidationCheck,
  OP_CONTRACT_CHECK_ID,
  OP_CONTRACT_CHECK_VERSION,
  OP_CONTRACT_FAILURE_CODES,
  operationContractKey,
  parseOperationRef,
} from "./checks/operation-contract-validation.js";
export type { OpContractFailureCode } from "./checks/operation-contract-validation.js";

// Phase 1 stub factories
export {
  PHASE1_STUB_VERSION,
  securityValidationCheck,
  privacyValidationCheck,
  accessibilityValidationCheck,
  runtimeCompatibilityCheck,
  adapterCapabilityCoverageCheck,
  performanceBudgetCheck,
  aiGovernanceCheck,
  rollbackReadinessCheck,
} from "./checks/phase1-stubs.js";
