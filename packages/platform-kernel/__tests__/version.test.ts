import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  InMemoryMetadataRegistry,
} from "@appbana/metadata-registry";

import {
  InMemoryGovernanceRegistry,
  LoadedCamCache,
  buildVersionInfo,
  resolveCam,
} from "../dist/index.js";

import { makeCam, makeSubmission } from "./fixtures.ts";

describe("buildVersionInfo", () => {
  it("returns the fixed shape when no CAMs are loaded", () => {
    const info = buildVersionInfo({
      kernelVersion: "0.1.0",
      platformVersion: "0.1.0",
      deploymentMode: "saas",
      cache: new LoadedCamCache(),
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });
    assert.equal(info.kernelVersion, "0.1.0");
    assert.equal(info.platformVersion, "0.1.0");
    assert.equal(info.deploymentMode, "saas");
    assert.deepEqual(info.loadedCams, []);
    assert.deepEqual(info.loadedAdapters, []);
    assert.equal(info.generatedAt, "2026-07-25T12:00:00.000Z");
  });

  it("enumerates loaded CAMs sorted by (appId, tenantId)", async () => {
    const meta = new InMemoryMetadataRegistry({
      now: () => new Date("2026-07-25T00:00:00.000Z"),
    });
    const gov = new InMemoryGovernanceRegistry({
      now: () => new Date("2026-07-25T00:00:01.000Z"),
    });
    const cache = new LoadedCamCache();

    // Insert three CAM/pointer/loaded-triples deliberately out of order.
    const specs = [
      { appId: "app.b", tenantId: "tenant.demo", camId: "cam.b@1.0.0" },
      { appId: "app.a", tenantId: "tenant.beta", camId: "cam.a-beta@1.0.0" },
      { appId: "app.a", tenantId: "tenant.alpha", camId: "cam.a-alpha@1.0.0" },
    ];
    for (const s of specs) {
      const stored = await meta.record(
        makeSubmission({
          appId: s.appId,
          tenantId: s.tenantId,
          content: makeCam({ camId: s.camId, appId: s.appId }),
        }),
      );
      await gov.activate({
        appId: s.appId,
        tenantId: s.tenantId,
        camContentHash: stored.contentHash,
        camVersion: "1.0.0",
        gateReportId: `sha256:report-${s.appId}-${s.tenantId}`,
        activatedBy: "principal.platform-admin",
      });
      await resolveCam(s.appId, s.tenantId, {
        governanceRegistry: gov,
        metadataRegistry: meta,
        cache,
        now: () => new Date("2026-07-25T00:00:02.000Z"),
      });
    }

    const info = buildVersionInfo({
      kernelVersion: "0.1.0",
      platformVersion: "0.1.0",
      deploymentMode: "dedicated-cloud",
      cache,
      now: () => new Date("2026-07-25T12:34:56.000Z"),
    });
    assert.deepEqual(
      info.loadedCams.map((c) => `${c.appId}/${c.tenantId}/${c.camId}`),
      [
        "app.a/tenant.alpha/cam.a-alpha@1.0.0",
        "app.a/tenant.beta/cam.a-beta@1.0.0",
        "app.b/tenant.demo/cam.b@1.0.0",
      ],
    );
    assert.equal(info.deploymentMode, "dedicated-cloud");
  });

  it("passes through loadedAdapters when supplied (reserved for WS-1.4 Task 4)", () => {
    const info = buildVersionInfo({
      kernelVersion: "0.1.0",
      platformVersion: "0.1.0",
      deploymentMode: "air-gapped",
      cache: new LoadedCamCache(),
      loadedAdapters: [
        { binding: "kernel:state-transition", kind: "internal", version: "0.1.0" },
      ],
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });
    assert.equal(info.loadedAdapters.length, 1);
    assert.equal(info.loadedAdapters[0]?.binding, "kernel:state-transition");
  });

  it("byte-stable output for the same input", () => {
    const cache = new LoadedCamCache();
    const a = buildVersionInfo({
      kernelVersion: "0.1.0",
      platformVersion: "0.1.0",
      deploymentMode: "saas",
      cache,
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });
    const b = buildVersionInfo({
      kernelVersion: "0.1.0",
      platformVersion: "0.1.0",
      deploymentMode: "saas",
      cache,
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
});
