import test from "node:test";
import assert from "node:assert/strict";
// Import expression as internal API via the same dist barrel path.
// mapExpression is not on the public API; tests use generate.ts to exercise it end-to-end.
import { generateCam } from "../dist/index.js";
import { FIXED_AIM_CONTENT_HASH, FIXED_GENERATED_AT, FIXED_GENERATOR } from "./fixtures.ts";

function optsFor(overrides: Partial<Parameters<typeof generateCam>[1]> = {}): Parameters<typeof generateCam>[1] {
  return {
    generator: FIXED_GENERATOR,
    camId: "cam.expr-test",
    camReleaseTag: "expr-test@2026.07",
    appId: "app.expr-test",
    generatedAt: FIXED_GENERATED_AT,
    aimContentHash: FIXED_AIM_CONTENT_HASH,
    ...overrides,
  };
}

function generate(aim: Parameters<typeof generateCam>[0]) {
  return generateCam(aim, optsFor());
}

test("shorthand {always} maps to {op:'always'}", () => {
  const aim = {
    rules: [{ id: "rule.a", kind: "field-requirement", description: "x", when: { always: true } }],
    entities: [{ id: "entity.x", name: "X", keys: { primary: ["id"] }, fields: [{ id: "f.x.id", name: "id", label: "id", type: "string", required: true, classification: "internal" }] }],
    roles: [{ id: "role.applicant", trust: "external" }],
  };
  const { cam } = generate(aim);
  const rule = (cam["RuleModel"] as { rules: Array<{ when: unknown }> }).rules[0]!;
  assert.deepEqual(rule.when, { op: "always" });
});

test("shorthand {and: [..]} maps to {op:'and', operands:[..]}", () => {
  const aim = {
    rules: [
      {
        id: "rule.a",
        kind: "field-requirement",
        description: "x",
        when: {
          and: [
            { eq: ["entity.customer.type", "individual"] },
            { ref: "rule.b" },
          ],
        },
      },
    ],
    entities: [{ id: "entity.customer", name: "Customer", keys: { primary: ["id"] }, fields: [{ id: "f.c.id", name: "id", label: "id", type: "string", required: true, classification: "internal" }] }],
    roles: [{ id: "role.applicant", trust: "external" }],
  };
  const { cam } = generate(aim);
  const rule = (cam["RuleModel"] as { rules: Array<{ when: { op: string; operands: unknown[] } }> }).rules[0]!;
  assert.equal(rule.when.op, "and");
  assert.equal(rule.when.operands.length, 2);
  assert.deepEqual(rule.when.operands[0], { op: "eq", left: { path: "entity.customer.type" }, right: { literal: "individual" } });
  assert.deepEqual(rule.when.operands[1], { op: "ref", ruleId: "rule.b" });
});

test("shorthand {any} maps to {op:'or'}", () => {
  const aim = {
    rules: [
      {
        id: "rule.a",
        kind: "field-requirement",
        description: "x",
        when: { any: [{ ref: "rule.b" }, { "role-is": "role.manager" }] },
      },
    ],
    entities: [{ id: "entity.x", name: "X", keys: { primary: ["id"] }, fields: [{ id: "f.x.id", name: "id", label: "id", type: "string", required: true, classification: "internal" }] }],
    roles: [{ id: "role.applicant", trust: "external" }],
  };
  const { cam } = generate(aim);
  const rule = (cam["RuleModel"] as { rules: Array<{ when: { op: string; operands: unknown[] } }> }).rules[0]!;
  assert.equal(rule.when.op, "or");
});

test("boolean unwrap: {and: [singleOperand]} collapses to operand", () => {
  const aim = {
    rules: [
      {
        id: "rule.a",
        kind: "field-requirement",
        description: "x",
        when: { and: [{ ref: "rule.b" }] },
      },
    ],
    entities: [{ id: "entity.x", name: "X", keys: { primary: ["id"] }, fields: [{ id: "f.x.id", name: "id", label: "id", type: "string", required: true, classification: "internal" }] }],
    roles: [{ id: "role.applicant", trust: "external" }],
  };
  const { cam, diagnostics } = generate(aim);
  const rule = (cam["RuleModel"] as { rules: Array<{ when: unknown }> }).rules[0]!;
  assert.deepEqual(rule.when, { op: "ref", ruleId: "rule.b" });
  assert.ok(diagnostics.some((d) => d.code === "CAM_GEN_BOOLEAN_UNWRAPPED"));
});

test("unknown shorthand falls back to {op:'always'} with EXPR_UNMAPPED", () => {
  const aim = {
    rules: [
      {
        id: "rule.a",
        kind: "field-requirement",
        description: "x",
        when: { magic: 42 } as unknown as never,
      },
    ],
    entities: [{ id: "entity.x", name: "X", keys: { primary: ["id"] }, fields: [{ id: "f.x.id", name: "id", label: "id", type: "string", required: true, classification: "internal" }] }],
    roles: [{ id: "role.applicant", trust: "external" }],
  };
  const { cam, diagnostics } = generate(aim);
  const rule = (cam["RuleModel"] as { rules: Array<{ when: unknown }> }).rules[0]!;
  assert.deepEqual(rule.when, { op: "always" });
  assert.ok(diagnostics.some((d) => d.code === "CAM_GEN_EXPR_UNMAPPED"));
});

test("comparator {eq: [pathish, literal]} distinguishes path vs literal operand", () => {
  const aim = {
    rules: [
      {
        id: "rule.a",
        kind: "field-requirement",
        description: "x",
        when: { eq: ["entity.customer.type", "business"] },
      },
    ],
    entities: [{ id: "entity.customer", name: "Customer", keys: { primary: ["id"] }, fields: [{ id: "f.c.id", name: "id", label: "id", type: "string", required: true, classification: "internal" }] }],
    roles: [{ id: "role.applicant", trust: "external" }],
  };
  const { cam } = generate(aim);
  const when = (cam["RuleModel"] as { rules: Array<{ when: { left: unknown; right: unknown } }> }).rules[0]!.when;
  assert.deepEqual(when.left, { path: "entity.customer.type" });
  assert.deepEqual(when.right, { literal: "business" });
});
