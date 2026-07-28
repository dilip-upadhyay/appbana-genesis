// Conformance suite tests.
//
// Two halves: the reference engine must pass every check, and each negative
// control must fail exactly the check it was built to violate. The second half
// is what proves the suite has teeth.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatReport, runConformanceSuite } from "../dist/index.js";
import type { ConformanceCheckId } from "../dist/index.js";
import {
  adHocEffectEngine,
  badTraceEngine,
  conformantFixtures,
  createTraceSchemaValidator,
  impureOutputEngine,
  incompleteTraceEngine,
  nonDeterministicDeclarationEngine,
  nonDeterministicEngine,
  referenceRulesEngine,
  throwingEngine,
  wrongSubModelEngine,
} from "./fixtures.ts";

const validator = createTraceSchemaValidator();
const fixtures = conformantFixtures as unknown as Parameters<typeof runConformanceSuite>[1];

function checksIn(violations: readonly { check: ConformanceCheckId }[]): Set<ConformanceCheckId> {
  return new Set(violations.map((v) => v.check));
}

describe("runConformanceSuite — reference engine", () => {
  it("certifies a fully conformant engine", async () => {
    const report = await runConformanceSuite(referenceRulesEngine, conformantFixtures, {
      traceSchemaValidator: validator,
    });
    assert.equal(report.conformant, true, formatReport(report));
    assert.equal(report.violations.length, 0);
    assert.equal(report.fixturesRun, 2);
  });

  it("validates every emitted trace event against the real published schema", async () => {
    const report = await runConformanceSuite(referenceRulesEngine, conformantFixtures, {
      traceSchemaValidator: validator,
    });
    assert.ok(report.checksRun.includes("trace-schema-validation"));
    assert.equal(
      report.violations.filter((v) => v.check === "trace-schema-validation").length,
      0,
      formatReport(report),
    );
  });

  it("reports the engine identity it certified", async () => {
    const report = await runConformanceSuite(referenceRulesEngine, conformantFixtures, {
      traceSchemaValidator: validator,
    });
    assert.equal(report.engineId, "runtime-rules");
    assert.equal(report.engineVersion, "0.1.0");
    assert.match(formatReport(report), /conformant/);
  });
});

describe("runConformanceSuite — negative controls", () => {
  it("detects a wall-clock / Math.random determinism violation", async () => {
    const report = await runConformanceSuite(nonDeterministicEngine, fixtures, {
      traceSchemaValidator: validator,
    });
    assert.equal(report.conformant, false);
    assert.ok(checksIn(report.violations).has("determinism"), formatReport(report));
  });

  it("detects an effect kind outside the closed union", async () => {
    const report = await runConformanceSuite(adHocEffectEngine, fixtures, {
      traceSchemaValidator: validator,
    });
    assert.equal(report.conformant, false);
    assert.ok(checksIn(report.violations).has("effect-union-membership"), formatReport(report));
    assert.match(
      report.violations.find((v) => v.check === "effect-union-membership")?.detail ?? "",
      /not in the closed EffectDescriptor union/,
    );
  });

  it("detects an engine claiming a sub-model it does not own", async () => {
    const report = await runConformanceSuite(wrongSubModelEngine, fixtures, {
      traceSchemaValidator: validator,
    });
    assert.equal(report.conformant, false);
    assert.ok(checksIn(report.violations).has("sub-model-ownership"), formatReport(report));
  });

  it("treats a thrown exception as a contract violation, not a crash", async () => {
    const report = await runConformanceSuite(throwingEngine, fixtures, {
      traceSchemaValidator: validator,
    });
    assert.equal(report.conformant, false);
    assert.ok(checksIn(report.violations).has("no-throw-on-expected-failure"), formatReport(report));
  });

  it("detects a trace event missing W3C trace context", async () => {
    const report = await runConformanceSuite(badTraceEngine, fixtures, {
      traceSchemaValidator: validator,
    });
    assert.equal(report.conformant, false);
    const detail = report.violations.find((v) => v.check === "trace-event-envelope")?.detail ?? "";
    assert.match(detail, /traceContext/);
  });

  it("detects non-JSON-safe output that could not cross a language boundary", async () => {
    const report = await runConformanceSuite(impureOutputEngine, fixtures, {
      traceSchemaValidator: validator,
    });
    assert.equal(report.conformant, false);
    assert.ok(checksIn(report.violations).has("purity-json-safe"), formatReport(report));
  });

  it("rejects capabilities.deterministic !== true", async () => {
    const report = await runConformanceSuite(nonDeterministicDeclarationEngine, fixtures, {
      traceSchemaValidator: validator,
    });
    assert.equal(report.conformant, false);
    assert.ok(checksIn(report.violations).has("capability-declaration"), formatReport(report));
  });

  it("detects a mandated trace decision that is never actually emitted", async () => {
    const report = await runConformanceSuite(incompleteTraceEngine, fixtures, {
      traceSchemaValidator: validator,
    });
    assert.equal(report.conformant, false);
    assert.ok(checksIn(report.violations).has("mandated-trace-completeness"), formatReport(report));
  });

  it("can suppress the completeness check while an engine is under construction", async () => {
    const report = await runConformanceSuite(incompleteTraceEngine, fixtures, {
      traceSchemaValidator: validator,
      allowIncompleteTraceCoverage: true,
    });
    assert.ok(!checksIn(report.violations).has("mandated-trace-completeness"));
    assert.ok(!report.checksRun.includes("mandated-trace-completeness"));
  });

  it("collects every violation rather than stopping at the first", async () => {
    const report = await runConformanceSuite(badTraceEngine, fixtures, {
      traceSchemaValidator: validator,
    });
    // badTraceEngine also fails completeness, since it emits no valid events.
    assert.ok(report.violations.length > 1, formatReport(report));
  });
});

describe("expected-output check", () => {
  it("flags an output that does not match its expectation", async () => {
    const report = await runConformanceSuite(referenceRulesEngine, [
      {
        name: "wrong-expectation",
        subModel: { rules: [{ id: "rule.a", whenField: "x", equals: "1" }] },
        input: { values: { x: "1" } },
        expectedOutput: { fired: [] },
      },
    ]);
    assert.equal(report.conformant, false);
    assert.ok(checksIn(report.violations).has("expected-output"), formatReport(report));
  });
});
