/**
 * Envelope-metadata builder — the CAM envelope's `metadata` slot.
 *
 * Pulls `sourceAim` from the AIM's own metadata section (id/version/contentHash),
 * and injects camId, camReleaseTag, appId, tenantId, environment, generatedAt,
 * and the generator identity. `generatedAt` is REQUIRED to be injected by the
 * caller — the generator never reads the wall clock (determinism).
 */

import type { JsonObject, GenerateCamOptions, AimDocument } from "./types.js";

export function buildEnvelopeMetadata(aim: AimDocument, opts: GenerateCamOptions): JsonObject {
  const sourceAim = extractSourceAim(aim, opts);
  const metadata: Record<string, unknown> = {
    camId: opts.camId,
    camReleaseTag: opts.camReleaseTag,
    generatedAt: opts.generatedAt,
    sourceAim,
    generator: { name: opts.generator.name, version: opts.generator.version },
  };
  if (typeof opts.appId === "string") metadata["appId"] = opts.appId;
  if (opts.tenantId !== undefined) metadata["tenantId"] = opts.tenantId;
  if (opts.environment !== undefined) metadata["environment"] = opts.environment;
  return metadata as JsonObject;
}

function extractSourceAim(aim: AimDocument, opts: GenerateCamOptions): JsonObject {
  const aimMeta = aim.metadata;
  const id =
    aimMeta !== undefined && typeof aimMeta["id"] === "string"
      ? aimMeta["id"]
      : "aim.unknown";
  const version = opts.aimVersion ?? (typeof aim.aimVersion === "string" ? aim.aimVersion : "0.1.0");
  return {
    id,
    version,
    contentHash: opts.aimContentHash,
  };
}
