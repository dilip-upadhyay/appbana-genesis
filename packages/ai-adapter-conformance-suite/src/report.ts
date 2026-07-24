/**
 * Conformance report shape.
 *
 * The report doubles as the wire form of a `conformanceEvidence[]` entry in the
 * AI Adapter Manifest v0.1 schema — an adapter that passes the suite can
 * check-in the emitted JSON verbatim as evidence.
 */

import type {
  AIConformanceTier,
  Diagnostic,
} from "@appbana/adapter-ai-contract";

/** Suite version. Bumps follow the same rules as ADR-015 amendments. */
export const AI_ADAPTER_CONFORMANCE_SUITE_VERSION = "0.1.0" as const;

/**
 * Stable identifier of a conformance check. Matches the `<tier>.<index>` scheme
 * documented in the package README, e.g. `"C.6"`, `"B.3"`, `"A.1"`.
 */
export type ConformanceCheckId = `${AIConformanceTier}.${number}`;

export interface ConformanceCheckResult {
  readonly id: ConformanceCheckId;
  readonly title: string;
  /** Tier this check belongs to. */
  readonly tier: AIConformanceTier;
  readonly passed: boolean;
  /**
   * True when the check is inapplicable to this adapter (e.g. determinism
   * check when the adapter does not declare `supportsDeterminismHint`).
   * Skipped checks do not fail the report.
   */
  readonly skipped?: boolean;
  /** Human-readable explanation of the outcome. MUST NOT contain PII. */
  readonly reason?: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ConformanceReportSummary {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface ConformanceReport {
  readonly conformanceSuiteVersion: typeof AI_ADAPTER_CONFORMANCE_SUITE_VERSION;
  /** Adapter binding as declared by `adapter.binding`, e.g. `"ai:anthropic-claude"`. */
  readonly adapterBinding: string;
  /** Adapter package version as declared by `capabilities.adapterVersion`. */
  readonly adapterVersion: string;
  /** Tier requested by the caller. All checks up to and including this tier were executed. */
  readonly tier: AIConformanceTier;
  /** ISO-8601 UTC timestamp when the runner finalized the report. */
  readonly executedAt: string;
  readonly summary: ConformanceReportSummary;
  readonly checks: readonly ConformanceCheckResult[];
  /** True iff every non-skipped check passed. */
  readonly passed: boolean;
}
