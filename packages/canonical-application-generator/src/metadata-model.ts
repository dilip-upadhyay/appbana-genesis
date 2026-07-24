/**
 * MetadataModel builder — the CAM's `MetadataModel` sub-model slot.
 *
 * Emits the provenance chain: [bim, aim, cam]. The CAM link points at itself,
 * so `contentHash` starts as `sha256:__pending__` (the schema permits it) and
 * is left un-rewritten in v0.1: the CAM's own hash (`GenerateCamResult.camContentHash`)
 * is the hash *of* the full envelope including this pending link.
 */

import type { JsonObject, GenerateCamOptions, AimDocument } from "./types.js";

const PENDING = "sha256:__pending__";

export function buildMetadataModel(
  aim: AimDocument,
  opts: GenerateCamOptions,
  subModelVersion: string,
): JsonObject {
  const aimMeta = (aim.metadata ?? {}) as JsonObject;
  const bimId = extractString(aimMeta, ["sourceBim", "id"]) ?? "bim.unknown";
  const bimVersion = opts.bimVersion ?? extractString(aimMeta, ["sourceBim", "version"]) ?? "0.1.0";
  const bimHash = opts.bimContentHash ?? extractString(aimMeta, ["sourceBim", "contentHash"]) ?? PENDING;

  const aimId = typeof aimMeta["id"] === "string" ? aimMeta["id"] : "aim.unknown";
  const aimVersion = opts.aimVersion ?? (typeof aim.aimVersion === "string" ? aim.aimVersion : "0.1.0");

  const provenance = aimMeta["provenance"] as JsonObject | undefined;
  const aimLink: Record<string, unknown> = {
    stage: "aim",
    artifactId: aimId,
    version: aimVersion,
    contentHash: opts.aimContentHash,
    producedAt: opts.generatedAt,
  };
  applyProvenance(aimLink, provenance);

  const provenanceChain: JsonObject[] = [
    {
      stage: "bim",
      artifactId: bimId,
      version: bimVersion,
      contentHash: bimHash,
      producedAt: opts.generatedAt,
    },
    aimLink as JsonObject,
    {
      stage: "cam",
      artifactId: opts.camId,
      version: opts.appVersion ?? "0.1.0",
      contentHash: PENDING,
      producedAt: opts.generatedAt,
      producedBy: opts.generator.name,
    },
  ];

  const model: Record<string, unknown> = {
    version: subModelVersion,
    appId: opts.appId ?? "app.unknown",
    provenanceChain,
  };
  if (typeof opts.appVersion === "string") model["appVersion"] = opts.appVersion;
  if (opts.tenantId !== undefined) model["tenantId"] = opts.tenantId;
  return model as JsonObject;
}

function extractString(obj: JsonObject, path: readonly string[]): string | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" ? cur : undefined;
}

const PROVENANCE_COPY_FIELDS = [
  "modelAdapter",
  "modelId",
  "promptTemplateId",
  "promptTemplateVersion",
] as const;

function applyProvenance(link: Record<string, unknown>, provenance: JsonObject | undefined): void {
  if (provenance === undefined) return;
  if (typeof provenance["translatedBy"] === "string") link["producedBy"] = provenance["translatedBy"];
  for (const key of PROVENANCE_COPY_FIELDS) {
    if (provenance[key] !== undefined) link[key] = provenance[key];
  }
  if (Array.isArray(provenance["reviewedBy"])) link["reviewedBy"] = provenance["reviewedBy"];
}
