/**
 * Ajv-based AIM validator smoke tests \u2014 proves the default validator wires up
 * against the shipped AIM v0.1 schema and accepts the reference Customer
 * Onboarding AIM.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { createAjvAimValidator } from "../dist/index.js";
import {
  AIM_SCHEMA_PATH,
  CUSTOMER_ONBOARDING_AIM_PATH,
  clone,
  loadJson,
} from "./fixtures.ts";

describe("createAjvAimValidator", () => {
  it("accepts the shipped Customer Onboarding AIM", () => {
    const validator = createAjvAimValidator({
      schema: loadJson(AIM_SCHEMA_PATH),
    });
    const result = validator(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    assert.equal(
      result.valid,
      true,
      `expected valid; errors:\n${JSON.stringify(result.errors, null, 2)}`,
    );
    assert.deepEqual(result.errors, []);
  });

  it("rejects a candidate missing a required top-level field", () => {
    const validator = createAjvAimValidator({
      schema: loadJson(AIM_SCHEMA_PATH),
    });
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    delete aim["metadata"];
    const result = validator(aim);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.keyword === "required"));
  });

  it("returns 'valid: false' with a non-empty errors[] on a wrong-typed field", () => {
    const validator = createAjvAimValidator({
      schema: loadJson(AIM_SCHEMA_PATH),
    });
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    aim["aimVersion"] = 42; // must be string per schema
    const result = validator(aim);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path.includes("aimVersion")));
  });
});
