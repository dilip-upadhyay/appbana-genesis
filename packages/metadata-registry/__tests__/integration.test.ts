import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ContentHashMismatchError,
  InMemoryMetadataRegistry,
  computeContentHash,
  verifyContentHash,
  verifyProvenanceChain,
  type JsonObject,
} from "../dist/index.js";

import { AIM_FIXTURE, BIM_FIXTURE, CAM_FIXTURE } from "./fixtures.ts";

/**
 * End-to-end scenario for the WS-1.3 exit criterion: BIM → AIM → CAM
 * artifacts flow through the registry with content-address integrity
 * verified on read AND the provenance-chain pointers verified across the
 * three rows.
 */
describe("integration — BIM → AIM → CAM round trip", () => {
  it("stores the triple, links via content-hash, and verifies the chain end-to-end", async () => {
    const reg = new InMemoryMetadataRegistry({
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });

    // 1. Store BIM.
    const bimEntry = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });

    // 2. Build AIM whose sourceBim.contentHash points at the stored BIM.
    const aim: JsonObject = {
      ...AIM_FIXTURE,
      sourceBim: {
        bimId: "bim.customer-onboarding@1.0.0",
        version: "1.0.0",
        contentHash: bimEntry.contentHash,
      },
    };
    const aimEntry = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "aim",
      version: "1.0.0",
      content: aim,
    });

    // 3. Build CAM whose metadata.sourceAim.contentHash points at the stored AIM.
    const cam: JsonObject = {
      ...CAM_FIXTURE,
      metadata: {
        sourceAim: {
          aimId: "aim.customer-onboarding@1.0.0",
          version: "1.0.0",
          contentHash: aimEntry.contentHash,
        },
      },
    };
    const camEntry = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "cam",
      version: "1.0.0",
      content: cam,
    });

    // 4. Re-fetch via `(appId, artifactKind, version)` query — the standard
    // path a runtime engine or governance validator uses.
    const bimHits = await reg.find({
      appId: "app.customer-onboarding",
      artifactKind: "bim",
      version: "1.0.0",
    });
    const aimHits = await reg.find({
      appId: "app.customer-onboarding",
      artifactKind: "aim",
      version: "1.0.0",
    });
    const camHits = await reg.find({
      appId: "app.customer-onboarding",
      artifactKind: "cam",
      version: "1.0.0",
    });
    assert.equal(bimHits.length, 1);
    assert.equal(aimHits.length, 1);
    assert.equal(camHits.length, 1);

    // 5. Content-hash integrity on read: recompute and compare.
    verifyContentHash(bimHits[0]!);
    verifyContentHash(aimHits[0]!);
    verifyContentHash(camHits[0]!);

    // 6. Full BIM→AIM→CAM chain verifies from the registry-fetched bodies.
    const hashes = verifyProvenanceChain(
      bimHits[0]!.content,
      aimHits[0]!.content,
      camHits[0]!.content,
    );
    assert.equal(hashes.bimHash, bimEntry.contentHash);
    assert.equal(hashes.aimHash, aimEntry.contentHash);
    assert.equal(hashes.camHash, camEntry.contentHash);
  });

  it("verifyContentHash detects post-hoc mutation of stored bytes (fail-closed)", async () => {
    const reg = new InMemoryMetadataRegistry();
    const stored = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    // Simulate stored-bytes drift (e.g. bad backfill).
    const tampered = {
      ...stored,
      content: { ...stored.content, tampered: true },
    };
    assert.throws(
      () => verifyContentHash(tampered),
      (err: unknown) => {
        assert.ok(err instanceof ContentHashMismatchError);
        return true;
      },
    );
  });

  it("query API by (appId, artifactKind, version) is the canonical retrieval path", async () => {
    const reg = new InMemoryMetadataRegistry();
    await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.1.0",
      content: { ...BIM_FIXTURE, version: "1.1.0" },
    });
    const v100 = await reg.find({
      appId: "app.customer-onboarding",
      artifactKind: "bim",
      version: "1.0.0",
    });
    assert.equal(v100.length, 1);
    assert.equal(v100[0]?.contentHash, computeContentHash(BIM_FIXTURE));
  });
});
