// Governance Publication Gate coordinator — ADR-017 Phase 1.
//
// Registers GateCheck plugins, drives their evaluation against a staged CAM
// input, collapses blocked verdicts to "waived" when an admissible waiver
// applies, folds missing mandatory checks to `blocked`, and returns an
// aggregate `GateReport` with a content-addressed id.
//
// The gate never touches the active-version pointer. Pointer swap lives in a
// separate operator (Phase 2) and consumes GateReports whose `overallOutcome`
// is "passed".

import { canonicalReportBytes, reportContentHash } from "./canonical.js";
import {
  assertWaiverAdmissible,
  waiverActiveAt,
} from "./waiver.js";
import {
  MANDATORY_CHECK_IDS,
  type Diagnostic,
  type GateCheck,
  type GateCheckContext,
  type GateCheckInput,
  type GateCheckVerdict,
  type GateReport,
  type GateWaiver,
  type JsonObject,
  type MandatoryCheckId,
} from "./types.js";

export { WaiverForbiddenError, WaiverInvalidError } from "./waiver.js";

/**
 * Error thrown when the gate is asked to evaluate before all 10 mandatory
 * checks have been registered. Fail-fast at load time so operations does not
 * discover the misconfiguration in production.
 */
export class GateNotReadyError extends Error {
  readonly code = "GATE_NOT_READY";
  readonly missingCheckIds: readonly string[];
  constructor(missing: readonly string[]) {
    super(
      `GovernanceGate is missing ${String(missing.length)} mandatory check(s): ${missing.join(", ")}`,
    );
    this.missingCheckIds = missing;
  }
}

export interface GovernanceGateOptions {
  readonly checks?: readonly GateCheck[];
}

export interface EvaluateOptions {
  readonly appId: string;
  readonly camId: string;
  readonly camVersion: string;
  readonly clock: () => string;
  /** UUID factory — injected for deterministic tests. */
  readonly newReportId?: () => string;
  readonly waivers?: readonly GateWaiver[];
  readonly prevActiveReportId?: string;
}

function reportIdFor(
  camId: string,
  camVersion: string,
  tenantId: string,
  evaluatedAt: string,
  verdicts: readonly GateCheckVerdict[],
): string {
  const seed = {
    kind: "gate-report-id",
    camId,
    camVersion,
    tenantId,
    evaluatedAt,
    verdictSummary: verdicts.map((v) => ({
      checkId: v.checkId,
      outcome: v.outcome,
      failureCode: v.failureCode,
    })),
  };
  return reportContentHash(seed as unknown as GateReport);
}

/**
 * Governance Publication Gate coordinator. One instance per platform kernel;
 * checks may be registered at load time and are then immutable for the life
 * of the process. Waiver admission is enforced in `evaluate`, not in the check
 * itself.
 */
export class GovernanceGate {
  private readonly checks = new Map<string, GateCheck>();

  constructor(options: GovernanceGateOptions = {}) {
    for (const check of options.checks ?? []) this.register(check);
  }

  /** Register a check. Throws if a check with the same id is already registered. */
  register(check: GateCheck): void {
    if (this.checks.has(check.id)) {
      throw new Error(`GovernanceGate already has a check registered with id "${check.id}"`);
    }
    this.checks.set(check.id, check);
  }

  /** Return the registered check ids in stable, sorted order. */
  registeredCheckIds(): readonly string[] {
    return [...this.checks.keys()].sort((a, b) => a.localeCompare(b));
  }

  /**
   * Return the mandatory check ids that have NOT yet been registered. A
   * production gate MUST have this list empty before serving evaluate().
   */
  missingMandatoryCheckIds(): readonly MandatoryCheckId[] {
    return MANDATORY_CHECK_IDS.filter((id) => !this.checks.has(id));
  }

  /**
   * Run all registered checks against `input`. Throws GateNotReadyError if
   * any mandatory check is unregistered.
   */
  async evaluate(input: GateCheckInput, opts: EvaluateOptions): Promise<GateReport> {
    const missing = this.missingMandatoryCheckIds();
    if (missing.length > 0) throw new GateNotReadyError(missing);

    // Admission-check every waiver up-front so a forbidden waiver aborts
    // before any check runs. Enforces ADR-017 § "Waivers".
    for (const w of opts.waivers ?? []) {
      assertWaiverAdmissible(w, input.criticality);
    }

    const ctx: GateCheckContext = { clock: opts.clock, appId: opts.appId };
    const evaluatedAt = opts.clock();

    const verdictPromises = [...this.checks.values()].map((c) => this.runOne(c, input, ctx));
    const rawVerdicts = await Promise.all(verdictPromises);

    const waiversByCheck = new Map<string, GateWaiver>();
    for (const w of opts.waivers ?? []) waiversByCheck.set(w.checkId, w);

    const now = opts.clock();
    const verdicts = rawVerdicts.map((v) => applyWaiver(v, waiversByCheck.get(v.checkId), now));

    // Fold in "not registered" blocked verdicts for any mandatory check that
    // is missing from the registered set. In practice this is unreachable
    // because we throw above, but ADR-017 requires the fail-closed semantics
    // to hold even if a check throws asynchronously; keep the defence.
    const emittedIds = new Set(verdicts.map((v) => v.checkId));
    for (const id of MANDATORY_CHECK_IDS) {
      if (!emittedIds.has(id)) verdicts.push(missingVerdict(id, now));
    }

    const overall: GateReport["overallOutcome"] = verdicts.every(
      (v) => v.outcome === "passed" || v.outcome === "waived",
    )
      ? "passed"
      : "blocked";

    const completedAt = opts.clock();
    const reportId =
      opts.newReportId?.() ??
      reportIdFor(opts.camId, opts.camVersion, input.tenantId, evaluatedAt, verdicts);

    // Sort verdicts by check id for a byte-stable report.
    const sortedVerdicts = [...verdicts].sort((a, b) => a.checkId.localeCompare(b.checkId));

    const report: GateReport = {
      gateReportVersion: "0.1",
      id: reportId,
      camId: opts.camId,
      camVersion: opts.camVersion,
      tenantId: input.tenantId,
      deploymentMode: input.deploymentMode,
      evaluatedAt,
      completedAt,
      overallOutcome: overall,
      verdicts: sortedVerdicts,
      signatures: [],
      ...(opts.prevActiveReportId !== undefined
        ? { prevActiveReportId: opts.prevActiveReportId }
        : {}),
    };
    return report;
  }

  private async runOne(
    check: GateCheck,
    input: GateCheckInput,
    ctx: GateCheckContext,
  ): Promise<GateCheckVerdict> {
    try {
      return await check.evaluate(input, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : "check threw";
      const diagnostic: Diagnostic = {
        severity: "error",
        code: "CHECK_THREW",
        message,
        path: "",
      };
      return {
        checkId: check.id,
        checkVersion: check.version,
        outcome: "blocked",
        failureCode: "CHECK_THREW",
        evidence: { threwMessage: message } as unknown as JsonObject,
        diagnostics: [diagnostic],
        evaluatedAt: ctx.clock(),
        durationMs: 0,
      };
    }
  }
}

function applyWaiver(
  verdict: GateCheckVerdict,
  waiver: GateWaiver | undefined,
  now: string,
): GateCheckVerdict {
  if (verdict.outcome !== "blocked") return verdict;
  if (waiver === undefined) return verdict;
  if (!waiverActiveAt(waiver, now)) return verdict;
  return { ...verdict, outcome: "waived", waiver };
}

function missingVerdict(id: MandatoryCheckId, now: string): GateCheckVerdict {
  return {
    checkId: id,
    checkVersion: "0.0.0",
    outcome: "blocked",
    failureCode: "CHECK_NOT_REGISTERED",
    evidence: { missingCheckId: id } as unknown as JsonObject,
    diagnostics: [
      { severity: "error", code: "CHECK_NOT_REGISTERED", message: `mandatory check "${id}" not registered`, path: "" },
    ],
    evaluatedAt: now,
    durationMs: 0,
  };
}

/**
 * Convenience: return canonical UTF-8 bytes of a report, suitable for hashing
 * and signing. See canonical.ts for the underlying rules.
 */
export function serializeReport(report: GateReport): Buffer {
  return canonicalReportBytes(report);
}


