import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { schemaValidationCheck } from "../dist/index.js";
import type { GateCheckInput, GateCheckContext, GateCheckVerdict, JsonObject } from "../dist/index.js";
import { CAM_EXAMPLE_PATH, CAM_SCHEMA_PATH, deepClone, makeClock, readJson } from "./fixtures.ts";

const SCHEMA = readJson<JsonObject>(CAM_SCHEMA_PATH);
const CAM = readJson<JsonObject>(CAM_EXAMPLE_PATH);

function baseInput(overrides: Partial<GateCheckInput> = {}): GateCheckInput {
  return {
    cam: deepClone(CAM),
    deploymentMode: "saas",
    tenantId: "tenant-1",
    criticality: "medium",
    camSchema: SCHEMA,
    operationContracts: new Map(),
    ...overrides,
  };
}

function context(): GateCheckContext {
  return { clock: makeClock(), appId: "app.customer-onboarding" };
}

async function runOn(cam: JsonObject): Promise<GateCheckVerdict> {
  const check = schemaValidationCheck();
  return check.evaluate(baseInput({ cam }), context());
}

describe("check.schema-validation", () => {
  it("passes for the shipped Customer Onboarding CAM", async () => {
    const verdict = await runOn(deepClone(CAM));
    if (verdict.outcome !== "passed") {
      console.error("Diagnostics:", JSON.stringify(verdict.diagnostics, null, 2));
    }
    assert.equal(verdict.outcome, "passed");
    assert.equal(verdict.failureCode, undefined);
    assert.deepEqual(verdict.diagnostics, []);
  });

  it("returns SCHEMA_MISSING_REQUIRED_FIELD when envelopeVersion is missing", async () => {
    const cam = deepClone(CAM);
    delete (cam as Record<string, unknown>)["envelopeVersion"];
    const verdict = await runOn(cam);
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "SCHEMA_MISSING_REQUIRED_FIELD");
    assert.equal(verdict.diagnostics[0]!.severity, "error");
  });

  it("returns SCHEMA_TYPE_MISMATCH when envelopeVersion is a number", async () => {
    const cam = deepClone(CAM);
    (cam as Record<string, unknown>)["envelopeVersion"] = 10;
    const verdict = await runOn(cam);
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "SCHEMA_TYPE_MISMATCH");
  });

  it("returns SCHEMA_PATTERN_VIOLATION when envelopeVersion is malformed", async () => {
    const cam = deepClone(CAM);
    (cam as Record<string, unknown>)["envelopeVersion"] = "not-a-version";
    const verdict = await runOn(cam);
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "SCHEMA_PATTERN_VIOLATION");
  });

  it("returns SCHEMA_ADDITIONAL_PROPERTY for an unexpected envelope field", async () => {
    const cam = deepClone(CAM);
    (cam as Record<string, unknown>)["ExtraNoseyField"] = "leak";
    const verdict = await runOn(cam);
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "SCHEMA_ADDITIONAL_PROPERTY");
  });

  it("returns SCHEMA_ENUM_VIOLATION when adapter.kind is invalid", async () => {
    const cam = deepClone(CAM);
    const opModel = (cam as Record<string, unknown>)["OperationModel"] as Record<string, unknown>;
    const ops = opModel["operations"] as Array<Record<string, unknown>>;
    (ops[0]!["adapter"] as Record<string, unknown>)["kind"] = "sqube";
    const verdict = await runOn(cam);
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "SCHEMA_ENUM_VIOLATION");
  });

  it("evidence.errorCount reflects the total ajv error count", async () => {
    const cam = deepClone(CAM);
    delete (cam as Record<string, unknown>)["envelopeVersion"];
    delete (cam as Record<string, unknown>)["metadata"];
    const verdict = await runOn(cam);
    assert.equal(verdict.outcome, "blocked");
    const ev = verdict.evidence as { errorCount: number; errors: unknown[] };
    assert.ok(ev.errorCount >= 2);
    assert.equal(ev.errors.length, ev.errorCount);
  });

  it("returns SCHEMA_COMPILE_FAILED when the schema is invalid", async () => {
    const brokenSchema: JsonObject = { type: "object", required: 42 } as unknown as JsonObject;
    const check = schemaValidationCheck();
    const verdict = await check.evaluate(baseInput({ camSchema: brokenSchema }), context());
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "SCHEMA_COMPILE_FAILED");
  });

  it("failure taxonomy is exposed and stable", () => {
    const check = schemaValidationCheck();
    assert.ok(check.failureTaxonomy.includes("SCHEMA_MISSING_REQUIRED_FIELD"));
    assert.ok(check.failureTaxonomy.includes("SCHEMA_PATTERN_VIOLATION"));
    assert.ok(check.failureTaxonomy.includes("SCHEMA_COMPILE_FAILED"));
  });
});
