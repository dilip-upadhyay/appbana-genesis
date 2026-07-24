/**
 * End-to-end validateAim orchestrator tests + normalization-agent adapter tests.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  createNormalizationAgentValidator,
  validateAim,
} from "../dist/index.js";
import {
  AIM_SCHEMA_PATH,
  CUSTOMER_ONBOARDING_AIM_PATH,
  clone,
  loadJson,
} from "./fixtures.ts";

describe("validateAim: happy path", () => {
  it("returns valid=true with an empty error set for the shipped AIM", () => {
    const schema = loadJson(AIM_SCHEMA_PATH);
    const aim = loadJson(CUSTOMER_ONBOARDING_AIM_PATH);
    const report = validateAim(aim, { schema });
    assert.equal(report.valid, true, report.summary);
    assert.deepEqual(report.schemaErrors, []);
    assert.deepEqual(report.referenceErrors, []);
    assert.deepEqual(report.duplicateIds, []);
    assert.equal(report.summary, "AIM validated");
  });
});

describe("validateAim: composite invalidity", () => {
  it("collects errors from all three phases in one pass", () => {
    const schema = loadJson(AIM_SCHEMA_PATH);
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));

    // 1. Break the schema: bad aimVersion type.
    aim["aimVersion"] = 42;

    // 2. Break a reference: enumRef to nowhere.
    const customer = (aim["entities"] as Record<string, unknown>[])[0]!;
    const fields = customer["fields"] as Record<string, unknown>[];
    fields[2]!["enumRef"] = "enum.does-not-exist";

    // 3. Introduce a duplicate role id.
    const roles = aim["roles"] as Record<string, unknown>[];
    roles.push({ ...roles[0] });

    const report = validateAim(aim, { schema });
    assert.equal(report.valid, false);
    assert.ok(report.schemaErrors.length >= 1);
    assert.ok(report.referenceErrors.length >= 1);
    assert.equal(report.duplicateIds.length, 1);
    assert.match(report.summary, /^AIM invalid:/);
  });
});

describe("validateAim: no-schema mode", () => {
  it("skips schema pass when no schema is provided but still catches refs/dupes", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const roles = aim["roles"] as Record<string, unknown>[];
    roles.push({ ...roles[0] });
    const report = validateAim(aim);
    assert.equal(report.schemaErrors.length, 0);
    assert.equal(report.duplicateIds.length, 1);
    assert.equal(report.valid, false);
  });
});

describe("createNormalizationAgentValidator", () => {
  it("returns a function matching the AimValidator signature", () => {
    const schema = loadJson(AIM_SCHEMA_PATH);
    const validator = createNormalizationAgentValidator({ schema });
    const aim = loadJson(CUSTOMER_ONBOARDING_AIM_PATH);
    const result = validator(aim);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("flattens all error kinds into a single errors[] array", () => {
    const schema = loadJson(AIM_SCHEMA_PATH);
    const validator = createNormalizationAgentValidator({ schema });
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    aim["aimVersion"] = 42;
    const roles = aim["roles"] as Record<string, unknown>[];
    roles.push({ ...roles[0] });

    const result = validator(aim);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
    const keywords = new Set(result.errors.map((e) => e.keyword));
    assert.ok(keywords.has("unique-id"));
  });

  it("rejects non-object candidates with a top-level error", () => {
    const validator = createNormalizationAgentValidator();
    const result = validator("not an object");
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.path, "/");
    assert.equal(result.errors[0]!.keyword, "type");
  });
});
