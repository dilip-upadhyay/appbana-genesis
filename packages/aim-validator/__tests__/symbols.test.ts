/**
 * Symbol-table tests.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { collectSymbolTable } from "../dist/index.js";
import { CUSTOMER_ONBOARDING_AIM_PATH, clone, loadJson } from "./fixtures.ts";

describe("collectSymbolTable: happy path", () => {
  it("collects every id from the shipped Customer Onboarding AIM", () => {
    const table = collectSymbolTable(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));

    // Sanity: at least the four canonical roles + five enums + three entities + one SM
    assert.ok(table.byId.has("role.applicant"));
    assert.ok(table.byId.has("role.reviewer"));
    assert.ok(table.byId.has("role.manager"));
    assert.ok(table.byId.has("role.auditor"));
    assert.ok(table.byId.has("enum.risk-band"));
    assert.ok(table.byId.has("enum.case-status"));
    assert.ok(table.byId.has("entity.customer"));
    assert.ok(table.byId.has("entity.onboarding-case"));
    assert.ok(table.byId.has("state-machine.case-lifecycle"));

    const roles = table.byKind.get("role") ?? [];
    assert.equal(roles.length, 4);
    const enums = table.byKind.get("enum") ?? [];
    assert.equal(enums.length, 5);

    assert.deepEqual(table.duplicates, []);
  });

  it("records definedAt with a JSON Pointer", () => {
    const table = collectSymbolTable(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const applicant = table.byId.get("role.applicant");
    assert.ok(applicant !== undefined);
    assert.equal(applicant!.kind, "role");
    assert.equal(applicant!.definedAt, "/roles/0/id");
  });
});

describe("collectSymbolTable: duplicates", () => {
  it("reports each duplicate id with both definition sites", () => {
    const aim = clone(loadJson(CUSTOMER_ONBOARDING_AIM_PATH));
    const roles = aim["roles"] as Record<string, unknown>[];
    roles.push({ ...roles[0] });
    const table = collectSymbolTable(aim);
    assert.equal(table.duplicates.length, 1);
    const dup = table.duplicates[0]!;
    assert.equal(dup.id, "role.applicant");
    assert.equal(dup.kind, "role");
    assert.equal(dup.firstDefinedAt, "/roles/0/id");
    assert.equal(dup.duplicateDefinedAt, `/roles/${roles.length - 1}/id`);
  });
});

describe("collectSymbolTable: skips malformed entries", () => {
  it("ignores non-object items and items missing an id", () => {
    const table = collectSymbolTable({
      roles: [
        { id: "role.ok" },
        null,
        { name: "no-id" },
        "not-an-object",
        { id: "" }, // empty id ignored
      ],
    });
    const roles = table.byKind.get("role") ?? [];
    assert.equal(roles.length, 1);
    assert.equal(roles[0]!.id, "role.ok");
  });
});
