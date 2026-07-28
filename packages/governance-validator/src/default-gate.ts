// Default gate factory — assembles the 10 registered checks (3 real + 7 stubs).

import { GovernanceGate } from "./gate.js";
import { schemaValidationCheck } from "./checks/schema-validation.js";
import { operationContractValidationCheck } from "./checks/operation-contract-validation.js";
import { accessibilityValidationCheck } from "./checks/accessibility-validation.js";
import {
  adapterCapabilityCoverageCheck,
  aiGovernanceCheck,
  performanceBudgetCheck,
  privacyValidationCheck,
  rollbackReadinessCheck,
  runtimeCompatibilityCheck,
  securityValidationCheck,
} from "./checks/phase1-stubs.js";
import type { GateCheck } from "./types.js";

/**
 * Assemble the Phase 1 default gate: schema-validation, operation-contract-
 * validation and accessibility-validation are real; the other seven are stubs
 * marked with `phase1Stub: true`. Callers may pre-populate a check to override
 * the default (useful for tests and for pilots that ship a real implementation
 * ahead of the roadmap).
 */
export function buildDefaultGate(overrides: readonly GateCheck[] = []): GovernanceGate {
  const overrideIds = new Set(overrides.map((c) => c.id));

  const defaults: GateCheck[] = [
    schemaValidationCheck(),
    operationContractValidationCheck(),
    securityValidationCheck(),
    privacyValidationCheck(),
    accessibilityValidationCheck(),
    runtimeCompatibilityCheck(),
    adapterCapabilityCoverageCheck(),
    performanceBudgetCheck(),
    aiGovernanceCheck(),
    rollbackReadinessCheck(),
  ];

  const checks: GateCheck[] = [
    ...overrides,
    ...defaults.filter((c) => !overrideIds.has(c.id)),
  ];

  return new GovernanceGate({ checks });
}
