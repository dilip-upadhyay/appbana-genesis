import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  InMemoryGovernanceRegistry,
  pointerKey,
} from "../dist/index.js";

const APP_ID = "app.customer-onboarding";
const TENANT = "tenant.demo";

function newRegistry(now = "2026-07-25T00:00:00.000Z"): InMemoryGovernanceRegistry {
  return new InMemoryGovernanceRegistry({ now: () => new Date(now) });
}

describe("InMemoryGovernanceRegistry", () => {
  it("activate creates a pointer with kind=active and injected clock", async () => {
    const reg = newRegistry("2026-07-25T00:00:00.000Z");
    const pointer = await reg.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: "sha256:aaa",
      camVersion: "1.0.0",
      gateReportId: "sha256:report-1",
      activatedBy: "principal.platform-admin",
    });
    assert.equal(pointer.appId, APP_ID);
    assert.equal(pointer.tenantId, TENANT);
    assert.equal(pointer.kind, "active");
    assert.equal(pointer.activatedAt, "2026-07-25T00:00:00.000Z");
    assert.equal(pointer.gateReportId, "sha256:report-1");
  });

  it("getActive returns undefined for an unknown (appId, tenantId)", async () => {
    const reg = newRegistry();
    assert.equal(await reg.getActive(APP_ID, TENANT), undefined);
  });

  it("getActive returns the pointer after activate", async () => {
    const reg = newRegistry();
    const written = await reg.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: "sha256:aaa",
      camVersion: "1.0.0",
      gateReportId: "sha256:report-1",
      activatedBy: "principal.platform-admin",
    });
    const read = await reg.getActive(APP_ID, TENANT);
    assert.deepEqual(read, written);
  });

  it("activate is idempotent for identical input — activatedAt stays stable", async () => {
    let tick = 0;
    const reg = new InMemoryGovernanceRegistry({
      now: () => new Date(Date.UTC(2026, 6, 25, 0, 0, tick++)),
    });
    const first = await reg.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: "sha256:aaa",
      camVersion: "1.0.0",
      gateReportId: "sha256:report-1",
      activatedBy: "principal.platform-admin",
    });
    const second = await reg.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: "sha256:aaa",
      camVersion: "1.0.0",
      gateReportId: "sha256:report-1",
      activatedBy: "principal.platform-admin",
    });
    assert.equal(first.activatedAt, second.activatedAt);
  });

  it("activate with a new camContentHash replaces the prior pointer and stamps a fresh activatedAt", async () => {
    let tick = 0;
    const reg = new InMemoryGovernanceRegistry({
      now: () => new Date(Date.UTC(2026, 6, 25, 0, 0, tick++)),
    });
    await reg.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: "sha256:aaa",
      camVersion: "1.0.0",
      gateReportId: "sha256:report-1",
      activatedBy: "principal.platform-admin",
    });
    const upgraded = await reg.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: "sha256:bbb",
      camVersion: "1.1.0",
      gateReportId: "sha256:report-2",
      activatedBy: "principal.platform-admin",
    });
    assert.equal(upgraded.camContentHash, "sha256:bbb");
    assert.equal(upgraded.camVersion, "1.1.0");
    assert.equal(upgraded.activatedAt, "2026-07-25T00:00:01.000Z");
    assert.equal((await reg.getActive(APP_ID, TENANT))?.camContentHash, "sha256:bbb");
  });

  it("pointers are isolated per tenantId", async () => {
    const reg = newRegistry();
    await reg.activate({
      appId: APP_ID,
      tenantId: "tenant.alpha",
      camContentHash: "sha256:alpha",
      camVersion: "1.0.0",
      gateReportId: "sha256:report-alpha",
      activatedBy: "principal.platform-admin",
    });
    await reg.activate({
      appId: APP_ID,
      tenantId: "tenant.beta",
      camContentHash: "sha256:beta",
      camVersion: "2.0.0",
      gateReportId: "sha256:report-beta",
      activatedBy: "principal.platform-admin",
    });
    const alpha = await reg.getActive(APP_ID, "tenant.alpha");
    const beta = await reg.getActive(APP_ID, "tenant.beta");
    assert.equal(alpha?.camContentHash, "sha256:alpha");
    assert.equal(beta?.camContentHash, "sha256:beta");
  });

  it("listActive returns pointers sorted (appId ASC, tenantId ASC)", async () => {
    const reg = newRegistry();
    await reg.activate({
      appId: "app.b",
      tenantId: "tenant.demo",
      camContentHash: "sha256:b",
      camVersion: "1.0.0",
      gateReportId: "sha256:rb",
      activatedBy: "u",
    });
    await reg.activate({
      appId: "app.a",
      tenantId: "tenant.beta",
      camContentHash: "sha256:ab",
      camVersion: "1.0.0",
      gateReportId: "sha256:rab",
      activatedBy: "u",
    });
    await reg.activate({
      appId: "app.a",
      tenantId: "tenant.alpha",
      camContentHash: "sha256:aa",
      camVersion: "1.0.0",
      gateReportId: "sha256:raa",
      activatedBy: "u",
    });
    const list = await reg.listActive();
    assert.deepEqual(
      list.map((p) => `${p.appId}/${p.tenantId}`),
      ["app.a/tenant.alpha", "app.a/tenant.beta", "app.b/tenant.demo"],
    );
  });

  it("pointerKey is stable for the same inputs and different for different tenants", () => {
    assert.equal(pointerKey("app.a", "tenant.x"), pointerKey("app.a", "tenant.x"));
    assert.notEqual(pointerKey("app.a", "tenant.x"), pointerKey("app.a", "tenant.y"));
    assert.notEqual(pointerKey("app.a", "tenant.x"), pointerKey("app.b", "tenant.x"));
  });
});
