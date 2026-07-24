/**
 * Schema-layer tests.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { compileSchemaValidator } from "../dist/index.js";
import {
  AIM_SCHEMA_PATH,
  CUSTOMER_ONBOARDING_AIM_PATH,
  clone,
  loadJson,
} from "./fixtures.ts";

describe("compileSchemaValidator", () => {
  it("accepts the shipped Customer Onboarding AIM", () => {
    const schema = loadJson(AIM_SCHEMA_PATH);
    const aim = loadJson(CUSTOMER_ONBOARDING_AIM_PATH);
    const validate = compileSchemaValidator(schema);
    const errors = validate(aim);
    assert.deepEqual(
      errors,
      [],
      `unexpected schema errors:\n${JSON.stringify(errors, null, 2)}`,
    );
  });

  it("rejects an AIM missing a required top-level field", () => {
    const schema = loadJson(AIM_SCHEMA_PATH);
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    delete aim["aimVersion"];
    const errors = compileSchemaValidator(schema)(aim);
    assert.ok(errors.length >= 1);
    assert.ok(errors.some((e) => e.keyword === "required"));
  });

  it("reports a JSON Pointer for each error", () => {
    const schema = loadJson(AIM_SCHEMA_PATH);
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    (aim["roles"] as Record<string, unknown>[])[0]!["id"] = 42; // wrong type
    const errors = compileSchemaValidator(schema)(aim);
    assert.ok(errors.length >= 1);
    for (const e of errors) {
      assert.equal(typeof e.path, "string");
      assert.ok(e.path.length > 0);
    }
  });
});
