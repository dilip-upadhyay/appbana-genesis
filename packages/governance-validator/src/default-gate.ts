// Default gate factory — assembles the 10 registered checks (2 real + 8 stubs).

import { GovernanceGate } from "./gate.js";
import { schemaValidationCheck } from "./checks/schema-validation.js";
import { operationContractValidationCheck } from "./checks/operation-contract-validation.js";
import {
  accessibilityValidationCheck,
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
 * Assemble the Phase 1 default gate: schema-validation + operation-contract-
 * validation are real; the other eight are stubs marked with `phase1Stub:
 * true`. Callers may pre-populate a check to override the default (useful for
 * tests and for pilots that ship a real implementation ahead of the roadmap).
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
