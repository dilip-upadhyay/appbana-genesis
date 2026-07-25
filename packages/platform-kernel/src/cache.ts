// LoadedCamCache — small in-memory cache keyed by (appId, tenantId,
// camContentHash). Written by the resolver on successful load; read by
// `buildVersionInfo()` to enumerate `/version`.
//
// Cache invalidation: on pointer change, the resolver evicts the entry for
// (appId, tenantId) BEFORE re-loading, so stale content-hash entries never
// linger. Phase 1 in-process only.

import type { LoadedCam } from "./types.js";

function cacheKey(appId: string, tenantId: string): string {
  return `${appId}\x00${tenantId}`;
}

export class LoadedCamCache {
  private readonly entries = new Map<string, LoadedCam>();

  set(loaded: LoadedCam): void {
    this.entries.set(cacheKey(loaded.appId, loaded.tenantId), loaded);
  }

  get(appId: string, tenantId: string): LoadedCam | undefined {
    return this.entries.get(cacheKey(appId, tenantId));
  }

  evict(appId: string, tenantId: string): void {
    this.entries.delete(cacheKey(appId, tenantId));
  }

  list(): readonly LoadedCam[] {
    return [...this.entries.values()].sort((a, b) => {
      if (a.appId !== b.appId) return a.appId.localeCompare(b.appId);
      return a.tenantId.localeCompare(b.tenantId);
    });
  }
}
