// Phase 1 stub GateChecks. Each of the seven not-yet-implemented checks returns
// `passed` with a distinguishing `evidence.phase1Stub: true` marker so
// consumers can filter stub verdicts out of dashboards until the real
// implementation lands. Waiver rules still apply — see ../waiver.ts.
//
// `check.accessibility-validation` left this file when ADR-018 gave it its
// first enforceable invariant; see ./accessibility-validation.ts.
//
// The `version` field is deliberately "0.0.0-phase1-stub" so any downstream
// registry consumer sees a distinctive semver string and knows the check has
// not yet shipped a real implementation. When each check lands its real
// evaluate() the semver bumps to 0.1.0.

import type {
  GateCheck,
  GateCheckContext,
  GateCheckInput,
  GateCheckVerdict,
  MandatoryCheckId,
} from "../types.js";

export const PHASE1_STUB_VERSION = "0.0.0-phase1-stub";

const STUB_EVIDENCE_CONTRACT = {
  type: "object",
  required: ["phase1Stub"],
  additionalProperties: false,
  properties: {
    phase1Stub: { type: "boolean", const: true },
    checkId: { type: "string" },
  },
} as const;

function makeStubCheck(id: MandatoryCheckId): GateCheck {
  const evaluate = async (
    _input: GateCheckInput,
    ctx: GateCheckContext,
  ): Promise<GateCheckVerdict> => ({
    checkId: id,
    checkVersion: PHASE1_STUB_VERSION,
    outcome: "passed",
    evidence: { phase1Stub: true, checkId: id },
    diagnostics: [],
    evaluatedAt: ctx.clock(),
    durationMs: 0,
  });
  return {
    id,
    version: PHASE1_STUB_VERSION,
    timeoutMs: 1_000,
    evidenceContract: STUB_EVIDENCE_CONTRACT as unknown as Record<string, never>,
    failureTaxonomy: [],
    evaluate,
  };
}

export const securityValidationCheck = (): GateCheck => makeStubCheck("check.security-validation");
export const privacyValidationCheck = (): GateCheck => makeStubCheck("check.privacy-validation");
export const runtimeCompatibilityCheck = (): GateCheck => makeStubCheck("check.runtime-compatibility");
export const adapterCapabilityCoverageCheck = (): GateCheck => makeStubCheck("check.adapter-capability-coverage");
export const performanceBudgetCheck = (): GateCheck => makeStubCheck("check.performance-budget");
export const aiGovernanceCheck = (): GateCheck => makeStubCheck("check.ai-governance");
export const rollbackReadinessCheck = (): GateCheck => makeStubCheck("check.rollback-readiness");
