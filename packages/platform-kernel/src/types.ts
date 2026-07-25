// @appbana/platform-kernel — public types.
//
// This package coordinates artifact resolution and (in later WS-1.4 tasks)
// session lifecycle, effect dispatch, and trace propagation. WS-1.4 Task 1
// scope: `ActiveVersionPointer` + `GovernanceRegistry` + `LoadedCam` +
// `VersionInfo`.
//
// ADR-017 says the Governance Registry is IMMUTABLE (append-only). The
// "pointer" here is the (appId, tenantId) → passing-GateReport binding.
// Phase 1 in-process only; Postgres driver is a follow-up.

import type { JsonObject } from "@appbana/metadata-registry";

/** Deployment mode surfaced on `/version` per ADR-016. */
export type DeploymentMode = "saas" | "dedicated-cloud" | "air-gapped";

/**
 * A one-per-`(appId, tenantId)` binding that tells the kernel which CAM is
 * currently serving traffic. Written by the Governance Gate via
 * `activate()` after a passing GateReport (ADR-017). The pointer itself is
 * NOT the CAM — it is a content-hash reference into the Metadata Registry.
 */
export interface ActiveVersionPointer {
  readonly appId: string;
  readonly tenantId: string;
  /** sha256:<hex> of the CAM canonicalised bytes (from Metadata Registry). */
  readonly camContentHash: string;
  /** semver of the CAM. Duplicated for cheap /version enumeration. */
  readonly camVersion: string;
  /** sha256:<hex> of the GateReport that authorised this activation. */
  readonly gateReportId: string;
  /** ISO-8601 UTC — set on `activate()`, never rewritten. */
  readonly activatedAt: string;
  /** Principal who activated. Recorded verbatim. */
  readonly activatedBy: string;
  /**
   * `active`: pointer is serving traffic.
   * `halted`: emergency-halt sentinel per ADR-017 — kernel refuses to serve
   * even though a pointer exists. Reserved for later WS-1.4 tasks; Phase 1
   * exposes the discriminator so downstream code is future-proof.
   */
  readonly kind: "active" | "halted";
}

/** Input for `GovernanceRegistry.activate`. */
export interface ActivateInput {
  readonly appId: string;
  readonly tenantId: string;
  readonly camContentHash: string;
  readonly camVersion: string;
  readonly gateReportId: string;
  readonly activatedBy: string;
}

/**
 * Phase 1 in-process governance registry. Postgres implementation is a
 * future task per ADR-017 (immutable table with active pointer view).
 *
 * All methods are async because production drivers WILL be I/O-bound; the
 * in-memory driver simply returns resolved Promises.
 */
export interface GovernanceRegistry {
  /**
   * Set / replace the active pointer for `(appId, tenantId)`. First-write
   * wins on `activatedAt` for the same pointer-content; a change to any
   * field produces a fresh pointer and stamps a new `activatedAt`.
   */
  activate(input: ActivateInput): Promise<ActiveVersionPointer>;
  /** Read the current pointer, or undefined if none has been set. */
  getActive(appId: string, tenantId: string): Promise<ActiveVersionPointer | undefined>;
  /**
   * Snapshot of every `(appId, tenantId)` with an active or halted pointer.
   * Used by `/version` to enumerate loaded CAMs. Sort is
   * `(appId ASC, tenantId ASC)` for byte-stable output.
   */
  listActive(): Promise<readonly ActiveVersionPointer[]>;
}

/**
 * The kernel-side materialised CAM. Held in the runtime cache; enumerated
 * by `/version`.
 */
export interface LoadedCam {
  readonly appId: string;
  readonly tenantId: string;
  readonly camId: string;
  readonly camVersion: string;
  readonly camContentHash: string;
  readonly gateReportId: string;
  /** Full CAM body. */
  readonly cam: JsonObject;
  /** When the resolver last loaded (or refreshed) this CAM. */
  readonly loadedAt: string;
}

/** One row in `VersionInfo.loadedCams`. */
export interface LoadedCamSummary {
  readonly appId: string;
  readonly tenantId: string;
  readonly camId: string;
  readonly camVersion: string;
  readonly camContentHash: string;
  readonly gateReportId: string;
  readonly loadedAt: string;
}

/** One row in `VersionInfo.loadedAdapters`. Reserved for WS-1.4 Task 4. */
export interface LoadedAdapterSummary {
  readonly binding: string;
  readonly kind: string;
  readonly version: string;
}

/**
 * The response payload for `GET /version` per ADR-016. Consumed by change
 * advisory boards and observability probes. Pure function of registry state
 * — see `buildVersionInfo()`.
 */
export interface VersionInfo {
  readonly kernelVersion: string;
  readonly platformVersion: string;
  readonly deploymentMode: DeploymentMode;
  readonly loadedCams: readonly LoadedCamSummary[];
  readonly loadedAdapters: readonly LoadedAdapterSummary[];
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// Errors — every failure mode is a distinct error class so the kernel can
// map to the correct HTTP status and the Trace Viewer can categorise.
// ---------------------------------------------------------------------------

/** Thrown when no pointer exists for the requested (appId, tenantId). */
export class NoActivePointerError extends Error {
  readonly code = "NO_ACTIVE_POINTER";
  readonly appId: string;
  readonly tenantId: string;
  constructor(appId: string, tenantId: string) {
    super(`no active-version pointer for (appId=${appId}, tenantId=${tenantId})`);
    this.appId = appId;
    this.tenantId = tenantId;
  }
}

/** Thrown when the pointer exists but has been halted via emergency-halt. */
export class PointerHaltedError extends Error {
  readonly code = "POINTER_HALTED";
  readonly appId: string;
  readonly tenantId: string;
  readonly gateReportId: string;
  constructor(pointer: ActiveVersionPointer) {
    super(
      `pointer for (appId=${pointer.appId}, tenantId=${pointer.tenantId}) is halted (gateReportId=${pointer.gateReportId})`,
    );
    this.appId = pointer.appId;
    this.tenantId = pointer.tenantId;
    this.gateReportId = pointer.gateReportId;
  }
}

/** Thrown when the pointer references a content-hash absent from the registry. */
export class CamNotFoundError extends Error {
  readonly code = "CAM_NOT_FOUND";
  readonly camContentHash: string;
  constructor(camContentHash: string) {
    super(`CAM ${camContentHash} not found in metadata registry`);
    this.camContentHash = camContentHash;
  }
}

/** Thrown when the resolved artifact is not a CAM. */
export class CamKindMismatchError extends Error {
  readonly code = "CAM_KIND_MISMATCH";
  readonly camContentHash: string;
  readonly actualKind: string;
  constructor(camContentHash: string, actualKind: string) {
    super(
      `artifact ${camContentHash} has kind "${actualKind}" but "cam" was expected`,
    );
    this.camContentHash = camContentHash;
    this.actualKind = actualKind;
  }
}

/**
 * Thrown when the pointer's declared `camVersion` does not match the
 * `version` on the stored CAM artifact — indicates a corrupted or racy
 * activation.
 */
export class CamVersionMismatchError extends Error {
  readonly code = "CAM_VERSION_MISMATCH";
  readonly camContentHash: string;
  readonly pointerVersion: string;
  readonly storedVersion: string;
  constructor(
    camContentHash: string,
    pointerVersion: string,
    storedVersion: string,
  ) {
    super(
      `CAM ${camContentHash} pointer.camVersion="${pointerVersion}" but stored artifact.version="${storedVersion}"`,
    );
    this.camContentHash = camContentHash;
    this.pointerVersion = pointerVersion;
    this.storedVersion = storedVersion;
  }
}
