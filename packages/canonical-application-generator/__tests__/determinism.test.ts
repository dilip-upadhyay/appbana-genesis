import test from "node:test";
import assert from "node:assert/strict";
import { generateCam, contentHash } from "../dist/index.js";
import {
  AIM_PATH,
  FIXED_AIM_CONTENT_HASH,
  FIXED_GENERATED_AT,
  FIXED_GENERATOR,
  readJson,
} from "./fixtures.ts";

function opts(): Parameters<typeof generateCam>[1] {
  return {
    generator: FIXED_GENERATOR,
    camId: "cam.customer-onboarding",
    camReleaseTag: "onboarding@2026.07",
    appId: "app.customer-onboarding",
    tenantId: null,
    environment: "dev",
    generatedAt: FIXED_GENERATED_AT,
    aimContentHash: FIXED_AIM_CONTENT_HASH,
  };
}

test("identical inputs produce byte-identical CAM (JSON stringify equality)", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const a = generateCam(aim, opts());
  const b = generateCam(aim, opts());
  assert.equal(JSON.stringify(a.cam), JSON.stringify(b.cam));
});

test("identical inputs produce identical camContentHash", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const a = generateCam(aim, opts());
  const b = generateCam(aim, opts());
  assert.equal(a.camContentHash, b.camContentHash);
  assert.match(a.camContentHash, /^sha256:[0-9a-f]{64}$/);
});

test("changing generatedAt changes the CAM (envelope metadata differs)", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const a = generateCam(aim, opts());
  const b = generateCam(aim, { ...opts(), generatedAt: "2027-01-01T00:00:00Z" });
  assert.notEqual(a.camContentHash, b.camContentHash);
});

test("camContentHash is the contentHash of the returned envelope", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam, camContentHash } = generateCam(aim, opts());
  assert.equal(camContentHash, contentHash(cam));
});

test("changing camId changes the CAM", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const a = generateCam(aim, opts());
  const b = generateCam(aim, { ...opts(), camId: "cam.customer-onboarding-v2" });
  assert.notEqual(a.camContentHash, b.camContentHash);
});
