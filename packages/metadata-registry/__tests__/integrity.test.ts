import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ContentHashMismatchError,
  ProvenanceChainMismatchError,
  computeContentHash,
  readSourceHash,
  verifyContentHash,
  verifyProvenanceChain,
  type JsonObject,
  type StoredArtifact,
} from "../dist/index.js";

import { AIM_FIXTURE, BIM_FIXTURE, CAM_FIXTURE } from "./fixtures.ts";

function tamper(stored: StoredArtifact, patch: JsonObject): StoredArtifact {
  return { ...stored, content: { ...stored.content, ...patch } };
}

function storedFrom(
  body: JsonObject,
  overrides: Partial<StoredArtifact> = {},
): StoredArtifact {
  const id = computeContentHash(body);
  return {
    id,
    contentHash: id,
    appId: "app.customer-onboarding",
    tenantId: "tenant.demo",
    artifactKind: "bim",
    version: "1.0.0",
    content: body,
    insertedAt: "2026-07-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("integrity — verifyContentHash", () => {
  it("returns the recomputed hash on a well-formed stored artifact", () => {
    const stored = storedFrom({ x: 1 });
    assert.equal(verifyContentHash(stored), stored.id);
  });

  it("throws ContentHashMismatchError when bytes drift from the declared id", () => {
    const stored = tamper(storedFrom({ x: 1 }), { x: 2 });
    assert.throws(() => verifyContentHash(stored), (err: unknown) => {
      assert.ok(err instanceof ContentHashMismatchError);
      assert.equal(err.code, "CONTENT_HASH_MISMATCH");
      return true;
    });
  });
});

describe("integrity — readSourceHash", () => {
  it("reads aim.sourceBim.contentHash for kind=aim", () => {
    assert.equal(readSourceHash(AIM_FIXTURE, "aim"), "sha256:__pending__");
  });

  it("reads cam.metadata.sourceAim.contentHash for kind=cam", () => {
    assert.equal(readSourceHash(CAM_FIXTURE, "cam"), "sha256:__pending__");
  });

  it("returns undefined when the link is missing", () => {
    assert.equal(readSourceHash({ nothing: true }, "aim"), undefined);
    assert.equal(readSourceHash({ metadata: {} }, "cam"), undefined);
  });
});

describe("integrity — verifyProvenanceChain", () => {
  it("returns the three hashes for a well-linked triple", () => {
    const bimHash = computeContentHash(BIM_FIXTURE);
    const aim: JsonObject = {
      ...AIM_FIXTURE,
      sourceBim: {
        bimId: "bim.customer-onboarding@1.0.0",
        version: "1.0.0",
        contentHash: bimHash,
      },
    };
    const aimHash = computeContentHash(aim);
    const cam: JsonObject = {
      ...CAM_FIXTURE,
      metadata: {
        sourceAim: {
          aimId: "aim.customer-onboarding@1.0.0",
          version: "1.0.0",
          contentHash: aimHash,
        },
      },
    };
    const camHash = computeContentHash(cam);
    const result = verifyProvenanceChain(BIM_FIXTURE, aim, cam);
    assert.deepEqual(result, { bimHash, aimHash, camHash });
  });

  it("accepts placeholder sha256:__pending__ links (unpinned upstream)", () => {
    // Fixtures use placeholders; call must not throw.
    const result = verifyProvenanceChain(BIM_FIXTURE, AIM_FIXTURE, CAM_FIXTURE);
    assert.match(result.bimHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.aimHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.camHash, /^sha256:[0-9a-f]{64}$/);
  });

  it("throws ProvenanceChainMismatchError when AIM.sourceBim.contentHash is wrong", () => {
    const bimHash = computeContentHash(BIM_FIXTURE);
    const wrongAim: JsonObject = {
      ...AIM_FIXTURE,
      sourceBim: {
        bimId: "bim.customer-onboarding@1.0.0",
        version: "1.0.0",
        contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
    };
    assert.throws(
      () => verifyProvenanceChain(BIM_FIXTURE, wrongAim, CAM_FIXTURE),
      (err: unknown) => {
        assert.ok(err instanceof ProvenanceChainMismatchError);
        assert.equal(err.linkKind, "aim.sourceBim");
        assert.equal(err.actualHash, bimHash);
        return true;
      },
    );
  });

  it("throws ProvenanceChainMismatchError when CAM.metadata.sourceAim.contentHash is wrong", () => {
    const bimHash = computeContentHash(BIM_FIXTURE);
    const goodAim: JsonObject = {
      ...AIM_FIXTURE,
      sourceBim: {
        bimId: "bim.customer-onboarding@1.0.0",
        version: "1.0.0",
        contentHash: bimHash,
      },
    };
    const wrongCam: JsonObject = {
      ...CAM_FIXTURE,
      metadata: {
        sourceAim: {
          aimId: "aim.customer-onboarding@1.0.0",
          version: "1.0.0",
          contentHash: "sha256:deadbeef",
        },
      },
    };
    assert.throws(
      () => verifyProvenanceChain(BIM_FIXTURE, goodAim, wrongCam),
      (err: unknown) => {
        assert.ok(err instanceof ProvenanceChainMismatchError);
        assert.equal(err.linkKind, "cam.sourceAim");
        return true;
      },
    );
  });
});
