import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  canonicalizeJson,
  canonicalizeJsonString,
  contentHash,
  reportContentHash,
  sha256Hex,
} from "../dist/index.js";
import type { GateReport } from "../dist/index.js";

describe("canonical.ts", () => {
  it("sorts object keys and drops undefined values", () => {
    const input = { z: 1, a: { c: 3, b: 2 }, x: undefined };
    const canon = canonicalizeJson(input);
    // Iterated in insertion order after canonicalisation → equal to sorted.
    assert.deepEqual(Object.keys(canon as Record<string, unknown>), ["a", "z"]);
    assert.deepEqual(
      Object.keys((canon as Record<string, unknown>)["a"] as Record<string, unknown>),
      ["b", "c"],
    );
  });

  it("preserves array order", () => {
    const s = canonicalizeJsonString([3, 1, 2]);
    assert.equal(s, "[3,1,2]");
  });

  it("produces byte-identical output for equal inputs regardless of key order", () => {
    const a = canonicalizeJsonString({ b: 1, a: 2 });
    const b = canonicalizeJsonString({ a: 2, b: 1 });
    assert.equal(a, b);
  });

  it("sha256Hex returns 64 lowercase hex characters", () => {
    const h = sha256Hex("hello");
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  it("contentHash format is sha256:<hex>", () => {
    const h = contentHash({ foo: "bar" });
    assert.match(h, /^sha256:[0-9a-f]{64}$/);
  });

  it("reportContentHash is deterministic for equal reports", () => {
    const r: GateReport = {
      gateReportVersion: "0.1",
      id: "urn:test",
      camId: "cam.x",
      camVersion: "0.1.0",
      tenantId: "tenant-1",
      deploymentMode: "saas",
      evaluatedAt: "2026-07-25T10:00:00.000Z",
      completedAt: "2026-07-25T10:00:00.100Z",
      overallOutcome: "passed",
      verdicts: [],
      signatures: [],
    };
    assert.equal(reportContentHash(r), reportContentHash({ ...r }));
  });
});
