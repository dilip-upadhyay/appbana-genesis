// Shared test fixtures — mirror the customer-onboarding vertical slice at a
// minimum level of realism so the provenance-chain link fields exist.

import type { JsonObject } from "../dist/index.js";

export const BIM_FIXTURE: JsonObject = {
  bimVersion: "0.1",
  bimId: "bim.customer-onboarding@1.0.0",
  appId: "app.customer-onboarding",
  version: "1.0.0",
  intent: "Open a personal current account for a retail customer.",
};

export const AIM_FIXTURE: JsonObject = {
  aimVersion: "0.1",
  aimId: "aim.customer-onboarding@1.0.0",
  appId: "app.customer-onboarding",
  version: "1.0.0",
  sourceBim: {
    bimId: "bim.customer-onboarding@1.0.0",
    version: "1.0.0",
    // populated later via computeContentHash for the link-integrity tests
    contentHash: "sha256:__pending__",
  },
  entities: [{ id: "customer", label: "Customer" }],
};

export const CAM_FIXTURE: JsonObject = {
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
  dataModel: { entities: [] },
  uiModel: { screens: [] },
};

export function withHash(body: JsonObject, patch: JsonObject): JsonObject {
  return { ...body, ...patch };
}
