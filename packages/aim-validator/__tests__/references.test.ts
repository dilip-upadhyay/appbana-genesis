/**
 * Reference-resolution tests.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { collectSymbolTable, resolveReferences } from "../dist/index.js";
import { CUSTOMER_ONBOARDING_AIM_PATH, clone, loadJson } from "./fixtures.ts";

describe("resolveReferences: happy path", () => {
  it("accepts the shipped Customer Onboarding AIM with zero errors", () => {
    const aim = loadJson(CUSTOMER_ONBOARDING_AIM_PATH);
    const table = collectSymbolTable(aim);
    const errors = resolveReferences(aim, table);
    assert.deepEqual(
      errors,
      [],
      `unexpected errors:\n${JSON.stringify(errors, null, 2)}`,
    );
  });
});

describe("resolveReferences: unknown ref detection", () => {
  it("flags an enumRef pointing at a non-existent enum", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const entities = aim["entities"] as Record<string, unknown>[];
    const customer = entities[0]! as Record<string, unknown>;
    const fields = customer["fields"] as Record<string, unknown>[];
    fields[2]!["enumRef"] = "enum.does-not-exist";
    const table = collectSymbolTable(aim);
    const errors = resolveReferences(aim, table);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.rule, "enumRef");
    assert.equal(errors[0]!.ref, "enum.does-not-exist");
    assert.match(errors[0]!.path, /^\/entities\/0\/fields\/2\/enumRef$/);
    assert.deepEqual(errors[0]!.expected, ["enum"]);
  });

  it("flags an assignedTo pointing at a non-existent role", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const sms = aim["stateMachines"] as Record<string, unknown>[];
    const states = sms[0]!["states"] as Record<string, unknown>[];
    states[0]!["assignedTo"] = "role.ghost";
    const table = collectSymbolTable(aim);
    const errors = resolveReferences(aim, table);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.ref, "role.ghost");
    assert.equal(errors[0]!.rule, "assignedTo");
  });

  it("flags an allowedRoles entry (array cardinality)", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const sms = aim["stateMachines"] as Record<string, unknown>[];
    const transitions = sms[0]!["transitions"] as Record<string, unknown>[];
    (transitions[0]!["allowedRoles"] as string[]).push("role.phantom");
    const table = collectSymbolTable(aim);
    const errors = resolveReferences(aim, table);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.ref, "role.phantom");
    assert.equal(errors[0]!.rule, "allowedRoles");
    assert.match(errors[0]!.path, /^\/stateMachines\/0\/transitions\/0\/allowedRoles\/\d+$/);
  });

  it("flags a triggeredBy pointing at a non-existent operation (with :vN suffix stripping)", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const sms = aim["stateMachines"] as Record<string, unknown>[];
    const transitions = sms[0]!["transitions"] as Record<string, unknown>[];
    transitions[0]!["triggeredBy"] = "operation.customer.does-not-exist:v1";
    const table = collectSymbolTable(aim);
    const errors = resolveReferences(aim, table);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.ref, "operation.customer.does-not-exist:v1");
    assert.equal(errors[0]!.rule, "triggeredBy");
  });
});

describe("resolveReferences: wrong-kind detection", () => {
  it("flags enumRef pointing at a role", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const entities = aim["entities"] as Record<string, unknown>[];
    const customer = entities[0]! as Record<string, unknown>;
    const fields = customer["fields"] as Record<string, unknown>[];
    fields[2]!["enumRef"] = "role.applicant";
    const table = collectSymbolTable(aim);
    const errors = resolveReferences(aim, table);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.rule, "enumRef");
    assert.match(errors[0]!.message, /points to a role.*but must point to a enum/);
  });
});

describe("resolveReferences: closest-suggestion", () => {
  it("suggests a nearby id when the ref is a plausible typo", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const entities = aim["entities"] as Record<string, unknown>[];
    const customer = entities[0]! as Record<string, unknown>;
    const fields = customer["fields"] as Record<string, unknown>[];
    fields[2]!["enumRef"] = "enum.customer-typ"; // typo of enum.customer-type
    const table = collectSymbolTable(aim);
    const errors = resolveReferences(aim, table);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.closestSuggestion, "enum.customer-type");
    assert.match(errors[0]!.message, /did you mean 'enum\.customer-type'/);
  });

  it("does not suggest anything far away", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const entities = aim["entities"] as Record<string, unknown>[];
    const customer = entities[0]! as Record<string, unknown>;
    const fields = customer["fields"] as Record<string, unknown>[];
    fields[2]!["enumRef"] = "enum.zzzz-totally-unrelated-longer-name";
    const table = collectSymbolTable(aim);
    const errors = resolveReferences(aim, table);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.closestSuggestion, undefined);
  });
});

describe("resolveReferences: interaction flows (ADR-018)", () => {
  const flows = (aim: Record<string, unknown>): Record<string, unknown>[] =>
    aim["interactionFlows"] as Record<string, unknown>[];

  it("flags a flow actor pointing at a non-existent role", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    (flows(aim)[0]!["actors"] as string[]).push("role.nobody");
    const errors = resolveReferences(aim, collectSymbolTable(aim));
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.rule, "actors");
    assert.equal(errors[0]!.ref, "role.nobody");
    assert.match(errors[0]!.path, /^\/interactionFlows\/0\/actors\/\d+$/);
  });

  it("flags a placement requiredWhen pointing at a non-existent rule", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const steps = flows(aim)[0]!["steps"] as Record<string, unknown>[];
    const groups = steps[0]!["groups"] as Record<string, unknown>[];
    const placements = groups[0]!["placements"] as Record<string, unknown>[];
    placements[0]!["requiredWhen"] = "rule.no-such-rule";
    const errors = resolveReferences(aim, collectSymbolTable(aim));
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.rule, "requiredWhen");
    assert.deepEqual(errors[0]!.expected, ["rule"]);
  });

  it("flags a step entryWhen pointing at a role instead of a rule", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const steps = flows(aim)[0]!["steps"] as Record<string, unknown>[];
    steps[0]!["entryWhen"] = "role.applicant";
    const errors = resolveReferences(aim, collectSymbolTable(aim));
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.rule, "entryWhen");
    assert.match(errors[0]!.message, /points to a role.*but must point to a rule/);
  });
});

describe("resolveReferences: false-positive guard", () => {
  it("ignores strings that do not begin with a known kind prefix", () => {
    // Some entity fields carry free-form strings like sourceBimAttribute; if
    // they happened to sit under a ref-carrying key by accident, we should NOT
    // panic on values that clearly are not AIM identifiers.
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const entities = aim["entities"] as Record<string, unknown>[];
    const customer = entities[0]! as Record<string, unknown>;
    const fields = customer["fields"] as Record<string, unknown>[];
    fields[2]!["enumRef"] = "not-an-aim-id"; // no dotted prefix
    const table = collectSymbolTable(aim);
    const errors = resolveReferences(aim, table);
    assert.deepEqual(errors, []);
  });
});
