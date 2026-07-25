// buildVersionInfo — pure function that produces the `/version` payload
// per ADR-016. The kernel HTTP layer (WS-1.4 Task 2/3) wires this to an
// endpoint; this module has NO transport concerns.

import type { LoadedCamCache } from "./cache.js";
import type {
  DeploymentMode,
  LoadedAdapterSummary,
  LoadedCamSummary,
  VersionInfo,
} from "./types.js";

export interface BuildVersionInfoInput {
  readonly kernelVersion: string;
  readonly platformVersion: string;
  readonly deploymentMode: DeploymentMode;
  readonly cache: LoadedCamCache;
  /**
   * Reserved for WS-1.4 Task 4 (effect descriptor dispatch). Phase 1 Task 1
   * callers pass `[]` — the field is on the wire so consumers see a stable
   * shape from day one.
   */
  readonly loadedAdapters?: readonly LoadedAdapterSummary[];
  /** Injected clock for determinism. */
  readonly now?: () => Date;
}

/**
 * Build the `/version` payload. Pure function of `input` — no I/O, no
 * hidden state. `generatedAt` is set from the injected clock so tests can
 * assert byte-stable output.
 *
 * The `loadedCams` array is sorted by `(appId ASC, tenantId ASC)` — the
 * same order the cache exposes via `list()`. Downstream consumers may rely
 * on this stability.
 */
export function buildVersionInfo(input: BuildVersionInfoInput): VersionInfo {
  const loadedCams: readonly LoadedCamSummary[] = input.cache
    .list()
    .map((loaded) => ({
      appId: loaded.appId,
      tenantId: loaded.tenantId,
      camId: loaded.camId,
      camVersion: loaded.camVersion,
      camContentHash: loaded.camContentHash,
      gateReportId: loaded.gateReportId,
      loadedAt: loaded.loadedAt,
    }));
  const now = input.now ?? (() => new Date());
  return {
    kernelVersion: input.kernelVersion,
    platformVersion: input.platformVersion,
    deploymentMode: input.deploymentMode,
    loadedCams,
    loadedAdapters: input.loadedAdapters ?? [],
    generatedAt: now().toISOString(),
  };
}
