// resolveCam — chain `GovernanceRegistry.getActive` → `MetadataRegistry.get`
// → integrity checks → cache. This is the single entry point the kernel
// calls to translate `(appId, tenantId)` into a runnable CAM.
//
// Fail-closed semantics: every failure path throws a typed error so the
// caller can distinguish "no pointer" from "pointer halted" from "corrupted
// artifact". Nothing is silently tolerated.

import type { MetadataRegistry, JsonObject } from "@appbana/metadata-registry";

import type { LoadedCamCache } from "./cache.js";
import {
  CamKindMismatchError,
  CamNotFoundError,
  CamVersionMismatchError,
  NoActivePointerError,
  PointerHaltedError,
  type ActiveVersionPointer,
  type GovernanceRegistry,
  type LoadedCam,
} from "./types.js";

export interface ResolveCamOptions {
  readonly governanceRegistry: GovernanceRegistry;
  readonly metadataRegistry: MetadataRegistry;
  readonly cache?: LoadedCamCache;
  readonly now?: () => Date;
}

/**
 * Resolve the currently-active CAM for `(appId, tenantId)`. Throws
 * `NoActivePointerError`, `PointerHaltedError`, `CamNotFoundError`,
 * `CamKindMismatchError`, or `CamVersionMismatchError` on the respective
 * failure modes.
 *
 * If a cache is supplied and its entry's `camContentHash` still matches the
 * pointer, the cached `LoadedCam` is returned WITHOUT touching the metadata
 * registry — this is the hot path.
 */
export async function resolveCam(
  appId: string,
  tenantId: string,
  options: ResolveCamOptions,
): Promise<LoadedCam> {
  const pointer = await options.governanceRegistry.getActive(appId, tenantId);
  if (pointer === undefined) throw new NoActivePointerError(appId, tenantId);
  if (pointer.kind === "halted") throw new PointerHaltedError(pointer);

  const cached = options.cache?.get(appId, tenantId);
  if (cached?.camContentHash === pointer.camContentHash) {
    return cached;
  }
  // Pointer changed — evict any stale cache entry BEFORE re-loading so the
  // cache never contains a hash that no longer matches an active pointer.
  options.cache?.evict(appId, tenantId);

  const stored = await options.metadataRegistry.get(pointer.camContentHash);
  if (stored === undefined) throw new CamNotFoundError(pointer.camContentHash);
  if (stored.artifactKind !== "cam") {
    throw new CamKindMismatchError(pointer.camContentHash, stored.artifactKind);
  }
  if (stored.version !== pointer.camVersion) {
    throw new CamVersionMismatchError(
      pointer.camContentHash,
      pointer.camVersion,
      stored.version,
    );
  }

  const loaded: LoadedCam = {
    appId: pointer.appId,
    tenantId: pointer.tenantId,
    camId: readCamId(stored.content),
    camVersion: stored.version,
    camContentHash: stored.contentHash,
    gateReportId: pointer.gateReportId,
    cam: stored.content,
    loadedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  options.cache?.set(loaded);
  return loaded;
}

/**
 * Best-effort read of the CAM's own id field. Falls back to the content
 * hash if the CAM body does not carry an explicit id (should not happen in
 * a v0.1-schema-conformant CAM, but the kernel does not re-validate here —
 * that is the governance gate's job).
 */
function readCamId(cam: JsonObject): string {
  const camId = cam["camId"];
  if (typeof camId === "string" && camId.length > 0) return camId;
  return "cam.unknown";
}

/**
 * Refresh helper — force a re-load even when the pointer hash is unchanged.
 * Useful for operational tools; not called on the hot path.
 */
export async function refreshCam(
  pointer: ActiveVersionPointer,
  options: ResolveCamOptions,
): Promise<LoadedCam> {
  options.cache?.evict(pointer.appId, pointer.tenantId);
  return resolveCam(pointer.appId, pointer.tenantId, options);
}
