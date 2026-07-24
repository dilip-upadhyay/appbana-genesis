import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { operationContractValidationCheck, operationContractKey, parseOperationRef } from "../dist/index.js";
import type { GateCheckInput, GateCheckContext, JsonObject } from "../dist/index.js";
import {
  CAM_EXAMPLE_PATH,
  CAM_SCHEMA_PATH,
  OP_CONTRACT_EXAMPLE_PATH,
  deepClone,
  makeClock,
  readJson,
} from "./fixtures.ts";

const SCHEMA = readJson<JsonObject>(CAM_SCHEMA_PATH);
const CAM = readJson<JsonObject>(CAM_EXAMPLE_PATH);
const SHIPPED_CONTRACT = readJson<JsonObject>(OP_CONTRACT_EXAMPLE_PATH);

type OpModel = { operations: Array<Record<string, unknown>> };

/** Build a contract registry from the CAM's declared operations. Contract
 *  shape mirrors the shipped Customer Onboarding contract — id, version,
 *  adapter.kind, sideEffects are populated so the check passes by default.
 */
function buildRegistry(cam: JsonObject): Map<string, JsonObject> {
  const registry = new Map<string, JsonObject>();
  const ops = ((cam["OperationModel"] as OpModel).operations) ?? [];
  for (const op of ops) {
    const id = op["id"] as string;
    const version = op["version"] as string;
    const key = operationContractKey(id, version);
    if (id === SHIPPED_CONTRACT["id"] && version === SHIPPED_CONTRACT["version"]) {
      registry.set(key, deepClone(SHIPPED_CONTRACT));
      continue;
    }
    registry.set(key, {
      operationContractVersion: "0.1",
      id,
      version,
      description: "synthetic contract for test",
      allowedRoles: op["allowedRoles"] ?? ["role.applicant"],
      idempotency: op["idempotency"] ?? { kind: "pure" },
      adapter: deepClone(op["adapter"] as JsonObject),
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      sideEffects: deepClone((op["sideEffects"] as unknown[]) ?? []),
      auditEvent: op["auditEvent"] ?? "unknown",
    } as JsonObject);
  }
  return registry;
}

function baseInput(overrides: Partial<GateCheckInput> = {}): GateCheckInput {
  const cam = overrides.cam ?? deepClone(CAM);
  return {
    cam,
    deploymentMode: "saas",
    tenantId: "tenant-1",
    criticality: "medium",
    camSchema: SCHEMA,
    operationContracts: buildRegistry(cam),
    ...overrides,
  };
}

function context(): GateCheckContext {
  return { clock: makeClock(), appId: "app.customer-onboarding" };
}

describe("check.operation-contract-validation", () => {
  it("passes when every CAM operation has a matching contract", async () => {
    const check = operationContractValidationCheck();
    const verdict = await check.evaluate(baseInput(), context());
    if (verdict.outcome !== "passed") {
      console.error("Diagnostics:", JSON.stringify(verdict.diagnostics, null, 2));
    }
    assert.equal(verdict.outcome, "passed");
    const ev = verdict.evidence as { checkedOperationCount: number; problemCount: number };
    assert.ok(ev.checkedOperationCount >= 1);
    assert.equal(ev.problemCount, 0);
  });

  it("returns OP_CONTRACT_MISSING when a contract is not in the registry", async () => {
    const cam = deepClone(CAM);
    const registry = buildRegistry(cam);
    registry.delete(operationContractKey("operation.customer.submit-onboarding", "1"));
    const check = operationContractValidationCheck();
    const verdict = await check.evaluate(
      baseInput({ cam, operationContracts: registry }),
      context(),
    );
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "OP_CONTRACT_MISSING");
  });

  it("returns OP_CONTRACT_ADAPTER_KIND_MISMATCH when adapter.kind diverges", async () => {
    const cam = deepClone(CAM);
    const registry = buildRegistry(cam);
    const key = operationContractKey("operation.customer.submit-onboarding", "1");
    const c = registry.get(key)! as JsonObject;
    const mutated: JsonObject = {
      ...c,
      adapter: { ...(c["adapter"] as JsonObject), kind: "notification" },
    };
    registry.set(key, mutated);
    const check = operationContractValidationCheck();
    const verdict = await check.evaluate(
      baseInput({ cam, operationContracts: registry }),
      context(),
    );
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "OP_CONTRACT_ADAPTER_KIND_MISMATCH");
  });

  it("returns OP_CONTRACT_VERSION_MISMATCH when the contract version diverges", async () => {
    const cam = deepClone(CAM);
    const registry = buildRegistry(cam);
    const key = operationContractKey("operation.customer.submit-onboarding", "1");
    const c = registry.get(key)! as JsonObject;
    registry.set(key, { ...c, version: "2" });
    const check = operationContractValidationCheck();
    const verdict = await check.evaluate(
      baseInput({ cam, operationContracts: registry }),
      context(),
    );
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "OP_CONTRACT_VERSION_MISMATCH");
  });

  it("returns OP_SIDE_EFFECT_UNDECLARED when CAM declares a side effect the contract does not", async () => {
    const cam = deepClone(CAM);
    // Add an undeclared side effect to the CAM operation.
    const ops = (cam["OperationModel"] as OpModel).operations;
    ops[0]!["sideEffects"] = [...((ops[0]!["sideEffects"] as unknown[]) ?? []), "persist.extra"];
    const registry = buildRegistry(CAM); // registry built from ORIGINAL, without the extra effect
    const check = operationContractValidationCheck();
    const verdict = await check.evaluate(
      baseInput({ cam, operationContracts: registry }),
      context(),
    );
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "OP_SIDE_EFFECT_UNDECLARED");
  });

  it("returns OP_REF_UNDECLARED when a workflow effect references an unknown operation", async () => {
    const cam = deepClone(CAM);
    // Inject a dispatch-operation effect that references an unknown operation.
    const workflow = cam["WorkflowModel"] as { stateMachines: Array<Record<string, unknown>> };
    const sm0 = workflow.stateMachines[0]!;
    const transitions = sm0["transitions"] as Array<Record<string, unknown>>;
    const firstT = transitions[0]!;
    const effs = ((firstT["effects"] as Array<Record<string, unknown>>) ?? []).slice();
    effs.push({ type: "dispatch-operation", operationRef: "operation.customer.does-not-exist:v1" });
    firstT["effects"] = effs;
    const check = operationContractValidationCheck();
    const verdict = await check.evaluate(baseInput({ cam }), context());
    assert.equal(verdict.outcome, "blocked");
    // First problem may be OP_CONTRACT_MISSING or OP_REF_UNDECLARED depending on ordering; assert one of the two failure codes appears.
    const codes = new Set(verdict.diagnostics.map((d) => d.code));
    assert.ok(codes.has("OP_REF_UNDECLARED"), "expected OP_REF_UNDECLARED in diagnostics");
  });

  it("parseOperationRef parses canonical refs and rejects malformed ones", () => {
    assert.deepEqual(parseOperationRef("operation.x.y:v3"), { id: "operation.x.y", version: "3" });
    assert.equal(parseOperationRef("operation.x.y"), null);
    assert.equal(parseOperationRef("operation.x.y:v"), null);
    assert.equal(parseOperationRef("operation.x.y:vNaN"), null);
  });

  it("failure taxonomy is exposed and stable", () => {
    const check = operationContractValidationCheck();
    assert.ok(check.failureTaxonomy.includes("OP_CONTRACT_MISSING"));
    assert.ok(check.failureTaxonomy.includes("OP_CONTRACT_ADAPTER_KIND_MISMATCH"));
    assert.ok(check.failureTaxonomy.includes("OP_REF_UNDECLARED"));
  });
});
