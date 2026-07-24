// Waiver admission rules per ADR-017.
//
// A waiver is a first-class artefact permitting one specific check-blocked
// verdict to collapse to "waived". ADR-017 defines these hard invariants:
//
//   * `check.schema-validation` and `check.runtime-compatibility` are
//     NON-waivable. Submitting a waiver for either is a load-time error.
//   * For criticality in {high, critical}:
//       - at least 2 distinct approvers are required
//       - expiresAt MUST be within 30 days of issuedAt
//   * For criticality in {low, medium}:
//       - at least 1 approver
//       - any expiry is accepted so long as it is strictly after issuedAt
//   * A waiver applies only when `now < expiresAt`.
//
// This module owns the enforcement. The gate coordinator calls
// `assertWaiverAdmissible` on every waiver submitted to `evaluate`, and calls
// `waiverActiveAt` inside `runOne` to decide whether a "blocked" verdict may be
// collapsed to "waived".

import {
  NON_WAIVABLE_CHECK_IDS,
  type CamCriticality,
  type GateWaiver,
} from "./types.js";

/** Error thrown when a waiver is submitted for a non-waivable check. */
export class WaiverForbiddenError extends Error {
  readonly code = "WAIVER_FORBIDDEN";
  readonly checkId: string;
  constructor(checkId: string) {
    super(
      `waiver forbidden for check "${checkId}" — ADR-017 marks schema-validation and runtime-compatibility as non-waivable invariants.`,
    );
    this.checkId = checkId;
  }
}

/** Error thrown when a waiver fails the ADR-017 admission rules. */
export class WaiverInvalidError extends Error {
  readonly code: string;
  readonly checkId: string;
  constructor(code: string, checkId: string, message: string) {
    super(message);
    this.code = code;
    this.checkId = checkId;
  }
}

const MAX_EXPIRY_MS_HIGH_CRITICALITY = 30 * 24 * 60 * 60 * 1000;

/**
 * Validate a waiver against ADR-017 admission rules. Throws
 * WaiverForbiddenError or WaiverInvalidError on rejection. Returns silently on
 * acceptance.
 */
export function assertWaiverAdmissible(
  waiver: GateWaiver,
  criticality: CamCriticality,
): void {
  if ((NON_WAIVABLE_CHECK_IDS as readonly string[]).includes(waiver.checkId)) {
    throw new WaiverForbiddenError(waiver.checkId);
  }

  const issued = Date.parse(waiver.issuedAt);
  const expires = Date.parse(waiver.expiresAt);
  if (!Number.isFinite(issued)) {
    throw new WaiverInvalidError(
      "WAIVER_ISSUED_AT_INVALID",
      waiver.checkId,
      `issuedAt "${waiver.issuedAt}" is not a valid ISO-8601 timestamp.`,
    );
  }
  if (!Number.isFinite(expires)) {
    throw new WaiverInvalidError(
      "WAIVER_EXPIRES_AT_INVALID",
      waiver.checkId,
      `expiresAt "${waiver.expiresAt}" is not a valid ISO-8601 timestamp.`,
    );
  }
  if (expires <= issued) {
    throw new WaiverInvalidError(
      "WAIVER_EXPIRES_BEFORE_ISSUED",
      waiver.checkId,
      "expiresAt must be strictly after issuedAt.",
    );
  }

  const distinctApprovers = new Set(waiver.approverIds).size;
  if (distinctApprovers < 1) {
    throw new WaiverInvalidError(
      "WAIVER_APPROVERS_INSUFFICIENT",
      waiver.checkId,
      "at least one approver id is required.",
    );
  }

  if (criticality === "high" || criticality === "critical") {
    if (distinctApprovers < 2) {
      throw new WaiverInvalidError(
        "WAIVER_APPROVERS_INSUFFICIENT",
        waiver.checkId,
        `criticality "${criticality}" requires at least 2 distinct approvers; got ${String(distinctApprovers)}.`,
      );
    }
    if (expires - issued > MAX_EXPIRY_MS_HIGH_CRITICALITY) {
      throw new WaiverInvalidError(
        "WAIVER_EXPIRY_TOO_LONG",
        waiver.checkId,
        `criticality "${criticality}" requires expiresAt within 30 days of issuedAt.`,
      );
    }
  }
}

/**
 * Return true if `waiver` is applicable at the given wall-clock instant.
 * ADR-017 says a waiver is only valid before its `expiresAt`.
 */
export function waiverActiveAt(waiver: GateWaiver, isoNow: string): boolean {
  const now = Date.parse(isoNow);
  const expires = Date.parse(waiver.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expires)) return false;
  return now < expires;
}
