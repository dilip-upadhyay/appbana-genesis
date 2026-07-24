import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  assertWaiverAdmissible,
  waiverActiveAt,
  WaiverForbiddenError,
  WaiverInvalidError,
  type GateWaiver,
} from "../dist/index.js";

function waiver(overrides: Partial<GateWaiver> = {}): GateWaiver {
  return {
    waiverId: "w-1",
    checkId: "check.security-validation",
    reason: "manual override",
    issuedBy: "user-1",
    issuedAt: "2026-07-25T10:00:00Z",
    expiresAt: "2026-07-26T10:00:00Z",
    approverIds: ["appr-1", "appr-2"],
    ...overrides,
  };
}

describe("waiver.ts admission rules", () => {
  it("rejects waivers for check.schema-validation (non-waivable)", () => {
    assert.throws(
      () => assertWaiverAdmissible(waiver({ checkId: "check.schema-validation" }), "low"),
      (err: unknown) => err instanceof WaiverForbiddenError && err.checkId === "check.schema-validation",
    );
  });

  it("rejects waivers for check.runtime-compatibility (non-waivable)", () => {
    assert.throws(
      () => assertWaiverAdmissible(waiver({ checkId: "check.runtime-compatibility" }), "low"),
      (err: unknown) => err instanceof WaiverForbiddenError,
    );
  });

  it("rejects a high-criticality waiver with only 1 approver", () => {
    assert.throws(
      () =>
        assertWaiverAdmissible(
          waiver({ approverIds: ["appr-1"] }),
          "high",
        ),
      (err: unknown) => err instanceof WaiverInvalidError && err.code === "WAIVER_APPROVERS_INSUFFICIENT",
    );
  });

  it("rejects a high-criticality waiver with expiry beyond 30 days", () => {
    assert.throws(
      () =>
        assertWaiverAdmissible(
          waiver({
            issuedAt: "2026-07-01T00:00:00Z",
            expiresAt: "2026-09-01T00:00:00Z",
          }),
          "critical",
        ),
      (err: unknown) => err instanceof WaiverInvalidError && err.code === "WAIVER_EXPIRY_TOO_LONG",
    );
  });

  it("accepts a high-criticality waiver with 2 approvers and 30-day expiry", () => {
    assert.doesNotThrow(() =>
      assertWaiverAdmissible(
        waiver({
          issuedAt: "2026-07-01T00:00:00Z",
          expiresAt: "2026-07-31T00:00:00Z",
        }),
        "high",
      ),
    );
  });

  it("accepts a low-criticality waiver with 1 approver and unlimited expiry", () => {
    assert.doesNotThrow(() =>
      assertWaiverAdmissible(
        waiver({
          approverIds: ["appr-1"],
          issuedAt: "2026-07-01T00:00:00Z",
          expiresAt: "2027-07-01T00:00:00Z",
        }),
        "low",
      ),
    );
  });

  it("rejects an expiresAt <= issuedAt", () => {
    assert.throws(
      () =>
        assertWaiverAdmissible(
          waiver({
            issuedAt: "2026-07-25T10:00:00Z",
            expiresAt: "2026-07-25T10:00:00Z",
          }),
          "low",
        ),
      (err: unknown) => err instanceof WaiverInvalidError && err.code === "WAIVER_EXPIRES_BEFORE_ISSUED",
    );
  });

  it("waiverActiveAt returns false for an expired waiver", () => {
    const w = waiver({ expiresAt: "2026-07-25T10:00:00Z" });
    assert.equal(waiverActiveAt(w, "2026-07-25T10:00:01Z"), false);
    assert.equal(waiverActiveAt(w, "2026-07-25T09:59:59Z"), true);
  });
});
