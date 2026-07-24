/**
 * Runner self-tests. Exercises the conformance suite against a fake adapter
 * built specifically to satisfy every Tier A assertion — a green run here
 * proves the harness, not the fake.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  AI_ADAPTER_CONFORMANCE_SUITE_VERSION,
  runConformance,
  makeRequest,
  DEFAULT_CORRELATION_IDS,
} from "../dist/index.js";

import { makeFakeAdapter } from "./fake-adapter.ts";

test("suite version is 0.1.0", () => {
  assert.equal(AI_ADAPTER_CONFORMANCE_SUITE_VERSION, "0.1.0");
});

test("Tier C: every check passes on the fake adapter", async () => {
  const report = await runConformance(makeFakeAdapter(), {
    tier: "C",
    config: {},
  });
  assert.equal(report.tier, "C");
  assert.equal(report.passed, true, formatFailures(report));
  assert.equal(report.checks.length, 7);
  for (const c of report.checks) {
    assert.equal(c.tier, "C");
    assert.equal(c.passed, true, `${c.id} ${c.title}: ${c.reason ?? "(no reason)"}`);
  }
});

test("Tier B: every check passes on the fake adapter", async () => {
  const report = await runConformance(makeFakeAdapter(), {
    tier: "B",
    config: {},
  });
  assert.equal(report.tier, "B");
  assert.equal(report.passed, true, formatFailures(report));
  assert.equal(report.checks.length, 12);
  const budget = report.checks.find((c) => c.id === "B.3");
  assert.ok(budget);
  assert.equal(budget.passed, true, `B.3 must pass: ${budget.reason ?? ""}`);
  assert.notEqual(budget.skipped, true, "fake declares cost fields, B.3 must not skip");
});

test("Tier A: every check passes on the fake adapter (with redaction fixture)", async () => {
  const redactionRequest = makeRequest({
    correlationId: DEFAULT_CORRELATION_IDS.redaction,
    responseContract: { kind: "free-text" },
    inputs: { message: "SSN: 000-00-0000" },
  });

  const report = await runConformance(makeFakeAdapter(), {
    tier: "A",
    config: {},
    fixtures: {
      redactionRequest,
      expectedRedactionPaths: ["/inputs/message"],
    },
  });

  assert.equal(report.tier, "A");
  assert.equal(report.passed, true, formatFailures(report));
  assert.equal(report.checks.length, 16);

  const a2 = report.checks.find((c) => c.id === "A.2");
  const a3 = report.checks.find((c) => c.id === "A.3");
  const a4 = report.checks.find((c) => c.id === "A.4");
  assert.ok(a2 && a3 && a4);
  assert.notEqual(a2.skipped, true, "A.2 must not skip when supportsDeterminismHint=true");
  assert.notEqual(a3.skipped, true, "A.3 must not skip when redactionRequest is supplied");
  assert.notEqual(a4.skipped, true, "A.4 must not skip when dataResidencyGuarantee is set");
});

test("summary counters and executedAt are populated", async () => {
  const report = await runConformance(makeFakeAdapter(), {
    tier: "B",
    config: {},
  });
  const { passed, failed, skipped } = report.summary;
  assert.equal(passed + failed + skipped, report.checks.length);
  assert.equal(failed, 0);
  assert.ok(!Number.isNaN(Date.parse(report.executedAt)));
  assert.equal(report.adapterBinding, "ai:fake-echo");
  assert.equal(report.adapterVersion, "0.1.0");
});

test("failing adapter surfaces C.7 failure without throwing", async () => {
  const broken = makeFakeAdapter({
    forceCorrelationId: "wrong-id-echoed-by-broken-adapter",
  });
  const report = await runConformance(broken, {
    tier: "C",
    config: {},
  });
  assert.equal(report.passed, false);
  const c7 = report.checks.find((c) => c.id === "C.7");
  assert.ok(c7);
  assert.equal(c7.passed, false);
  assert.match(c7.reason ?? "", /correlationId/i);
});

test("air-gapped invariant failure is caught by A.1", async () => {
  const broken = makeFakeAdapter({
    capabilities: {
      requiresNetwork: false,
      egressesInputsToThirdParty: true,
    },
  });
  const report = await runConformance(broken, {
    tier: "A",
    config: {},
    fixtures: {
      redactionRequest: makeRequest({
        correlationId: DEFAULT_CORRELATION_IDS.redaction,
        responseContract: { kind: "free-text" },
        inputs: { message: "SSN: 000-00-0000" },
      }),
      expectedRedactionPaths: ["/inputs/message"],
    },
  });
  const a1 = report.checks.find((c) => c.id === "A.1");
  assert.ok(a1);
  assert.equal(a1.passed, false);
  assert.equal(report.passed, false);
});

test("kind mismatch failure is caught by C.1", async () => {
  const broken = makeFakeAdapter({
    capabilities: { kind: "embedding" },
  });
  const report = await runConformance(broken, {
    tier: "C",
    config: {},
  });
  const c1 = report.checks.find((c) => c.id === "C.1");
  assert.ok(c1);
  assert.equal(c1.passed, false);
  assert.equal(report.passed, false);
});

function formatFailures(report: {
  readonly checks: readonly {
    readonly id: string;
    readonly title: string;
    readonly passed: boolean;
    readonly skipped?: boolean;
    readonly reason?: string;
  }[];
}): string {
  const failed = report.checks
    .filter((c) => !c.passed && c.skipped !== true)
    .map((c) => `  ${c.id} ${c.title}: ${c.reason ?? "(no reason)"}`);
  return failed.length === 0 ? "" : `\n${failed.join("\n")}`;
}
