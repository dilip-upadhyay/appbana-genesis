import type {
  ArtifactSubmission,
  JsonObject,
  StoredArtifact,
} from "@appbana/metadata-registry";

/** A minimal CAM body carrying the fields the resolver inspects. */
export function makeCam(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    camVersion: "0.1",
    camId: "cam.customer-onboarding@1.0.0",
    appId: "app.customer-onboarding",
    version: "1.0.0",
    metadata: {
      sourceAim: {
        aimId: "aim.customer-onboarding@1.0.0",
        version: "1.0.0",
        contentHash: "sha256:__pending__",
      },
    },
    ...overrides,
  };
}

export function makeSubmission(
  overrides: Partial<ArtifactSubmission> = {},
): ArtifactSubmission {
  return {
    appId: "app.customer-onboarding",
    tenantId: "tenant.demo",
    artifactKind: "cam",
    version: "1.0.0",
    content: makeCam(),
    ...overrides,
  };
}

/** Sentinel StoredArtifact — useful for direct-injection failure-mode tests. */
export function makeStored(overrides: Partial<StoredArtifact> = {}): StoredArtifact {
  return {
    id: "sha256:abcd",
    contentHash: "sha256:abcd",
    appId: "app.customer-onboarding",
    tenantId: "tenant.demo",
    artifactKind: "cam",
    version: "1.0.0",
    content: makeCam(),
    insertedAt: "2026-07-25T12:00:00.000Z",
    ...overrides,
  };
}
