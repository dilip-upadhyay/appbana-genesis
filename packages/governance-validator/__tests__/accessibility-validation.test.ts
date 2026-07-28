import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { accessibilityValidationCheck } from "../dist/index.js";
import type {
  GateCheckContext,
  GateCheckInput,
  GateCheckVerdict,
  JsonObject,
} from "../dist/index.js";
import { CAM_EXAMPLE_PATH, CAM_SCHEMA_PATH, deepClone, makeClock, readJson } from "./fixtures.ts";

/**
 * ADR-018 compliance check #5 — a layout the generator invented must not reach
 * anyone but a developer.
 *
 * The CAM generator is allowed to fall back to a role x entity cross-product
 * when the AIM carries no `interactionFlows`, because refusing outright would
 * break the pipeline for anyone mid-migration. What it is not allowed to do is
 * let that fallback activate. This check is the enforcement point.
 */

const SCHEMA = readJson<JsonObject>(CAM_SCHEMA_PATH);
const CAM = readJson<JsonObject>(CAM_EXAMPLE_PATH);

function context(): GateCheckContext {
  return { clock: makeClock(), appId: "app.customer-onboarding" };
}

function inputFor(cam: JsonObject): GateCheckInput {
  return {
    cam,
    deploymentMode: "saas",
    tenantId: "tenant-1",
    criticality: "medium",
    camSchema: SCHEMA,
    operationContracts: new Map(),
  };
}

/** Clone the reference CAM with a specific layout origin and target environment. */
function camWith(origin: string | undefined, environment: string | undefined): JsonObject {
  const cam = deepClone(CAM) as Record<string, unknown>;
  const interaction = cam["InteractionModel"] as Record<string, unknown>;
  const metadata = cam["metadata"] as Record<string, unknown>;
  if (origin === undefined) delete interaction["origin"];
  else interaction["origin"] = origin;
  if (environment === undefined) delete metadata["environment"];
  else metadata["environment"] = environment;
  return cam as JsonObject;
}

async function run(cam: JsonObject): Promise<GateCheckVerdict> {
  return accessibilityValidationCheck().evaluate(inputFor(cam), context());
}

describe("check.accessibility-validation", () => {
  it("passes the shipped CAM, whose layout came from stated intent", async () => {
    const verdict = await run(deepClone(CAM));
    assert.equal(verdict.outcome, "passed");
    assert.equal(verdict.failureCode, undefined);
    assert.deepEqual(verdict.diagnostics, []);
  });

  for (const environment of ["staging", "canary", "prod"]) {
    it(`blocks a generator-invented layout in ${environment}`, async () => {
      const verdict = await run(camWith("generator-fallback", environment));
      assert.equal(verdict.outcome, "blocked");
      assert.equal(verdict.failureCode, "ACCESSIBILITY_UNREVIEWED_LAYOUT");
      assert.equal(verdict.diagnostics[0]?.severity, "error");
    });
  }

  it("allows a generator-invented layout in dev, but says so out loud", async () => {
    const verdict = await run(camWith("generator-fallback", "dev"));
    assert.equal(verdict.outcome, "passed");
    assert.equal(verdict.diagnostics.length, 1);
    assert.equal(verdict.diagnostics[0]?.severity, "warning");
  });

  it("fails closed when the CAM does not say which environment it targets", async () => {
    // An unspecified environment is not a dev environment. A check that treats
    // absence as permission is a check that can be disabled by deletion.
    const verdict = await run(camWith("generator-fallback", undefined));
    assert.equal(verdict.outcome, "blocked");
    assert.equal(verdict.failureCode, "ACCESSIBILITY_UNREVIEWED_LAYOUT");
  });

  it("does not block a CAM that predates the origin member", async () => {
    // `origin` is optional in CAM v0.2 so pre-ADR-018 artifacts keep activating.
    // They are not proof of a reviewed layout, but they are not proof of an
    // invented one either, and this check does not guess.
    const verdict = await run(camWith(undefined, "prod"));
    assert.equal(verdict.outcome, "passed");
  });

  it("reports which accessibility assertions it has not yet implemented", async () => {
    // A green verdict from a check that only inspects layout provenance must not
    // read as "this application is accessible".
    const verdict = await run(deepClone(CAM));
    const evidence = verdict.evidence as Record<string, unknown>;
    assert.deepEqual(evidence["assertionsImplemented"], ["layout-provenance"]);
    assert.ok(
      (evidence["assertionsNotYetImplemented"] as string[]).length > 0,
      "The evidence must be honest about what this check does not yet cover.",
    );
  });

  it("is no longer a Phase 1 stub", async () => {
    const verdict = await run(deepClone(CAM));
    assert.notEqual(verdict.checkVersion, "0.0.0-phase1-stub");
    assert.equal((verdict.evidence as Record<string, unknown>)["phase1Stub"], undefined);
  });
});
