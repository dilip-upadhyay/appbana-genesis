import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  InMemoryMetadataRegistry,
  type JsonObject,
} from "@appbana/metadata-registry";

import {
  InMemoryGovernanceRegistry,
  LoadedCamCache,
  buildVersionInfo,
  refreshCam,
  resolveCam,
} from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(HERE, "..", "..", "..");

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

describe("integration — WS-1.3 → WS-1.4 handoff", () => {
  it("resolves the shipped Customer Onboarding CAM end-to-end", async () => {
    const camBody = await readJson<JsonObject>(
      join(WORKSPACE, "examples", "customer-onboarding", "cam.json"),
    );

    const meta = new InMemoryMetadataRegistry({
      now: () => new Date("2026-07-25T00:00:00.000Z"),
    });
    const stored = await meta.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "cam",
      version: "1.0.0",
      content: camBody,
    });

    const gov = new InMemoryGovernanceRegistry({
      now: () => new Date("2026-07-25T00:00:01.000Z"),
    });
    await gov.activate({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      camContentHash: stored.contentHash,
      camVersion: "1.0.0",
      gateReportId: "sha256:shipped-gate-report",
      activatedBy: "principal.platform-admin",
    });

    const cache = new LoadedCamCache();
    const loaded = await resolveCam("app.customer-onboarding", "tenant.demo", {
      governanceRegistry: gov,
      metadataRegistry: meta,
      cache,
      now: () => new Date("2026-07-25T00:00:02.000Z"),
    });
    assert.equal(loaded.camVersion, "1.0.0");
    assert.equal(loaded.camContentHash, stored.contentHash);
    // The shipped CAM carries its own camId — sanity check that the resolver
    // read it correctly.
    assert.equal(typeof loaded.camId, "string");
    assert.ok(loaded.camId.length > 0);

    const info = buildVersionInfo({
      kernelVersion: "0.1.0",
      platformVersion: "0.1.0",
      deploymentMode: "saas",
      cache,
      now: () => new Date("2026-07-25T00:00:03.000Z"),
    });
    assert.equal(info.loadedCams.length, 1);
    assert.equal(info.loadedCams[0]?.camContentHash, stored.contentHash);
    assert.equal(info.loadedCams[0]?.gateReportId, "sha256:shipped-gate-report");
  });

  it("refreshCam forces a re-load even when the pointer hash is unchanged", async () => {
    const meta = new InMemoryMetadataRegistry();
    const stored = await meta.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "cam",
      version: "1.0.0",
      content: { camId: "cam.x", version: "1.0.0" },
    });
    const gov = new InMemoryGovernanceRegistry();
    const pointer = await gov.activate({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      camContentHash: stored.contentHash,
      camVersion: "1.0.0",
      gateReportId: "sha256:gate-1",
      activatedBy: "principal.platform-admin",
    });
    const cache = new LoadedCamCache();

    let loadedAtTick = 0;
    const opts = {
      governanceRegistry: gov,
      metadataRegistry: meta,
      cache,
      now: () => new Date(Date.UTC(2026, 6, 25, 0, 0, loadedAtTick++)),
    };
    const first = await resolveCam("app.customer-onboarding", "tenant.demo", opts);
    const refreshed = await refreshCam(pointer, opts);
    assert.notEqual(first.loadedAt, refreshed.loadedAt);
    assert.equal(first.camContentHash, refreshed.camContentHash);
  });
});
