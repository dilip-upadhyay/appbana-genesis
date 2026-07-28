import type { JsonObject } from "@appbana/metadata-registry";
import { InMemoryMetadataRegistry } from "@appbana/metadata-registry";
import { InMemoryGovernanceRegistry } from "@appbana/platform-kernel";

export const APP_ID = "app.customer-onboarding";
export const TENANT_ID = "tenant.demo";
export const PRINCIPAL_ID = "principal.alice";
export const CAM_VERSION = "1.0.0";
/** Must satisfy the trace-event schema pattern `^cam\.[a-z0-9][a-z0-9-]*$`. */
export const CAM_ID = "cam.customer-onboarding";

export function makeCam(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    camId: CAM_ID,
    camVersion: "0.1",
    appId: APP_ID,
    version: CAM_VERSION,
    metadata: {
      sourceAim: { contentHash: "sha256:__pending__" },
    },
    ...overrides,
  };
}

/**
 * Build a fresh in-memory metadata registry + governance registry pair with
 * an activated pointer for `(APP_ID, TENANT_ID) → CAM_VERSION`. Returns the
 * dependencies a `SessionLifecycle` needs.
 */
export async function seed(): Promise<{
  metadataRegistry: InMemoryMetadataRegistry;
  governanceRegistry: InMemoryGovernanceRegistry;
  camContentHash: string;
}> {
  const metadataRegistry = new InMemoryMetadataRegistry();
  const stored = await metadataRegistry.record({
    appId: APP_ID,
    tenantId: TENANT_ID,
    artifactKind: "cam",
    version: CAM_VERSION,
    content: makeCam(),
  });
  const governanceRegistry = new InMemoryGovernanceRegistry();
  await governanceRegistry.activate({
    appId: APP_ID,
    tenantId: TENANT_ID,
    camContentHash: stored.contentHash,
    camVersion: CAM_VERSION,
    gateReportId: "sha256:test-gate-report",
    activatedBy: "principal.platform-admin",
  });
  return {
    metadataRegistry,
    governanceRegistry,
    camContentHash: stored.contentHash,
  };
}
