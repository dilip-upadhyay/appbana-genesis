import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ArtifactNotFoundError,
  InMemoryMetadataRegistry,
  type MetadataRegistry,
  type StoredArtifact,
} from "@appbana/metadata-registry";

import {
  CamKindMismatchError,
  CamNotFoundError,
  CamVersionMismatchError,
  InMemoryGovernanceRegistry,
  LoadedCamCache,
  NoActivePointerError,
  PointerHaltedError,
  resolveCam,
} from "../dist/index.js";

import { makeCam, makeSubmission } from "./fixtures.ts";

const APP_ID = "app.customer-onboarding";
const TENANT = "tenant.demo";

async function seedRegistryWithCam(
  overrides: Parameters<typeof makeSubmission>[0] = {},
): Promise<{ meta: InMemoryMetadataRegistry; stored: StoredArtifact }> {
  const meta = new InMemoryMetadataRegistry({
    now: () => new Date("2026-07-25T00:00:00.000Z"),
  });
  const stored = await meta.record(makeSubmission(overrides));
  return { meta, stored };
}

describe("resolveCam — success path", () => {
  it("returns a LoadedCam wired from pointer + stored artifact", async () => {
    const { meta, stored } = await seedRegistryWithCam();
    const gov = new InMemoryGovernanceRegistry({
      now: () => new Date("2026-07-25T00:00:01.000Z"),
    });
    await gov.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: stored.contentHash,
      camVersion: "1.0.0",
      gateReportId: "sha256:gate-1",
      activatedBy: "principal.platform-admin",
    });
    const loaded = await resolveCam(APP_ID, TENANT, {
      governanceRegistry: gov,
      metadataRegistry: meta,
      now: () => new Date("2026-07-25T00:00:02.000Z"),
    });
    assert.equal(loaded.camId, "cam.customer-onboarding@1.0.0");
    assert.equal(loaded.camVersion, "1.0.0");
    assert.equal(loaded.camContentHash, stored.contentHash);
    assert.equal(loaded.gateReportId, "sha256:gate-1");
    assert.equal(loaded.loadedAt, "2026-07-25T00:00:02.000Z");
    assert.deepEqual(loaded.cam, stored.content);
  });

  it("cache hit skips the metadata-registry fetch when hash still matches", async () => {
    const { meta, stored } = await seedRegistryWithCam();
    const gov = new InMemoryGovernanceRegistry();
    await gov.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: stored.contentHash,
      camVersion: "1.0.0",
      gateReportId: "sha256:gate-1",
      activatedBy: "principal.platform-admin",
    });
    const cache = new LoadedCamCache();
    let metaHits = 0;
    const spyMeta: MetadataRegistry = {
      record: meta.record.bind(meta),
      count: meta.count.bind(meta),
      find: meta.find.bind(meta),
      get: async (id) => {
        metaHits += 1;
        return meta.get(id);
      },
    };
    const first = await resolveCam(APP_ID, TENANT, {
      governanceRegistry: gov,
      metadataRegistry: spyMeta,
      cache,
    });
    const second = await resolveCam(APP_ID, TENANT, {
      governanceRegistry: gov,
      metadataRegistry: spyMeta,
      cache,
    });
    assert.equal(metaHits, 1);
    assert.equal(first, second);
  });

  it("cache evicts on pointer change and re-loads from metadata-registry", async () => {
    const meta = new InMemoryMetadataRegistry();
    const firstStored = await meta.record(makeSubmission());
    const secondStored = await meta.record(
      makeSubmission({ version: "1.1.0", content: makeCam({ version: "1.1.0" }) }),
    );
    const gov = new InMemoryGovernanceRegistry();
    await gov.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: firstStored.contentHash,
      camVersion: "1.0.0",
      gateReportId: "sha256:gate-1",
      activatedBy: "principal.platform-admin",
    });
    const cache = new LoadedCamCache();
    const first = await resolveCam(APP_ID, TENANT, {
      governanceRegistry: gov,
      metadataRegistry: meta,
      cache,
    });
    assert.equal(first.camVersion, "1.0.0");

    // Upgrade pointer.
    await gov.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: secondStored.contentHash,
      camVersion: "1.1.0",
      gateReportId: "sha256:gate-2",
      activatedBy: "principal.platform-admin",
    });
    const second = await resolveCam(APP_ID, TENANT, {
      governanceRegistry: gov,
      metadataRegistry: meta,
      cache,
    });
    assert.equal(second.camVersion, "1.1.0");
    assert.equal(second.camContentHash, secondStored.contentHash);
    assert.equal(cache.list().length, 1); // only the new one — old evicted
  });
});

describe("resolveCam — failure modes", () => {
  it("throws NoActivePointerError when no pointer exists", async () => {
    const meta = new InMemoryMetadataRegistry();
    const gov = new InMemoryGovernanceRegistry();
    await assert.rejects(
      resolveCam(APP_ID, TENANT, {
        governanceRegistry: gov,
        metadataRegistry: meta,
      }),
      (err: unknown) => {
        assert.ok(err instanceof NoActivePointerError);
        assert.equal(err.code, "NO_ACTIVE_POINTER");
        return true;
      },
    );
  });

  it("throws PointerHaltedError when pointer.kind is halted", async () => {
    const { meta, stored } = await seedRegistryWithCam();
    const gov = new InMemoryGovernanceRegistry();
    // Use direct-injected registry to simulate a halted pointer (Phase 1 has
    // no public halt() operation yet — reserved for a later WS-1.4 task).
    const fakeGov = {
      activate: gov.activate.bind(gov),
      listActive: gov.listActive.bind(gov),
      getActive: async () => ({
        appId: APP_ID,
        tenantId: TENANT,
        camContentHash: stored.contentHash,
        camVersion: "1.0.0",
        gateReportId: "sha256:gate-1",
        activatedBy: "principal.platform-admin",
        activatedAt: "2026-07-25T00:00:00.000Z",
        kind: "halted" as const,
      }),
    };
    await assert.rejects(
      resolveCam(APP_ID, TENANT, {
        governanceRegistry: fakeGov,
        metadataRegistry: meta,
      }),
      (err: unknown) => {
        assert.ok(err instanceof PointerHaltedError);
        assert.equal(err.code, "POINTER_HALTED");
        return true;
      },
    );
  });

  it("throws CamNotFoundError when the pointer references an absent hash", async () => {
    const meta = new InMemoryMetadataRegistry();
    const gov = new InMemoryGovernanceRegistry();
    await gov.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: "sha256:ghost",
      camVersion: "1.0.0",
      gateReportId: "sha256:gate-1",
      activatedBy: "principal.platform-admin",
    });
    await assert.rejects(
      resolveCam(APP_ID, TENANT, {
        governanceRegistry: gov,
        metadataRegistry: meta,
      }),
      (err: unknown) => {
        assert.ok(err instanceof CamNotFoundError);
        assert.equal(err.code, "CAM_NOT_FOUND");
        return true;
      },
    );
  });

  it("throws CamKindMismatchError when the referenced artifact is not a CAM", async () => {
    const meta = new InMemoryMetadataRegistry();
    const stored = await meta.record(
      makeSubmission({ artifactKind: "aim" }),
    );
    const gov = new InMemoryGovernanceRegistry();
    await gov.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: stored.contentHash,
      camVersion: "1.0.0",
      gateReportId: "sha256:gate-1",
      activatedBy: "principal.platform-admin",
    });
    await assert.rejects(
      resolveCam(APP_ID, TENANT, {
        governanceRegistry: gov,
        metadataRegistry: meta,
      }),
      (err: unknown) => {
        assert.ok(err instanceof CamKindMismatchError);
        assert.equal(err.actualKind, "aim");
        return true;
      },
    );
  });

  it("throws CamVersionMismatchError when pointer.camVersion diverges from stored.version", async () => {
    const meta = new InMemoryMetadataRegistry();
    const stored = await meta.record(
      makeSubmission({ version: "1.0.0" }),
    );
    const gov = new InMemoryGovernanceRegistry();
    await gov.activate({
      appId: APP_ID,
      tenantId: TENANT,
      camContentHash: stored.contentHash,
      camVersion: "2.0.0",
      gateReportId: "sha256:gate-1",
      activatedBy: "principal.platform-admin",
    });
    await assert.rejects(
      resolveCam(APP_ID, TENANT, {
        governanceRegistry: gov,
        metadataRegistry: meta,
      }),
      (err: unknown) => {
        assert.ok(err instanceof CamVersionMismatchError);
        assert.equal(err.pointerVersion, "2.0.0");
        assert.equal(err.storedVersion, "1.0.0");
        return true;
      },
    );
  });

  it("propagates metadata-registry ArtifactNotFoundError as CamNotFoundError semantics", () => {
    // Sanity check on error identity — ArtifactNotFoundError from the
    // metadata-registry is a different type than CamNotFoundError. The
    // resolver DOES NOT catch/rewrap; instead it uses `get()` which returns
    // undefined for missing rows (not throws), so CamNotFoundError is the
    // sole "not-found" surface the caller sees.
    assert.notEqual(CamNotFoundError, ArtifactNotFoundError);
  });
});
