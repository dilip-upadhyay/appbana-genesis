// Governance Validator — public types (ADR-017 Phase 1 subset).
//
// Shape of every check plugin, verdict, report, and waiver. Every type is
// serialisable to JSON so that the canonicalised bytes of a `GateReport` may be
// signed and archived.

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json | undefined };

export type JsonObject = { readonly [key: string]: Json | undefined };

/**
 * Severity + code + JSON Pointer path structured diagnostic. Mirrors the shape
 * shared by ADR-013 engines and the AIM validator so callers can render every
 * diagnostic uniformly.
 */
export interface Diagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  /** JSON Pointer into the artefact under evaluation. Empty string = root. */
  readonly path: string;
}

/** Deployment mode the gate is running in — copied from ADR-016. */
export type DeploymentMode = "saas" | "dedicated-cloud" | "air-gapped";

/**
 * The CAM criticality label declared in `MetadataModel.criticality`. Waivers
 * for `high` and `critical` are subject to the tighter ADR-017 constraints
 * (2 approvers minimum, expiry ≤ 30 days).
 */
export type CamCriticality = "low" | "medium" | "high" | "critical";

/** Input handed to every GateCheck. */
export interface GateCheckInput {
  /** The CAM under evaluation. */
  readonly cam: JsonObject;
  /** Content-hash of the CAM (informational; may be echoed into evidence). */
  readonly camContentHash?: string;
  /** Deployment context — allows some checks to strengthen invariants. */
  readonly deploymentMode: DeploymentMode;
  /** Tenant the CAM will activate for. */
  readonly tenantId: string;
  /** CAM criticality (defaults to "medium" if the CAM omits it). */
  readonly criticality: CamCriticality;
  /**
   * The schema against which the CAM should validate. Injected so the check
   * package does not couple to the shipped `cam.v0.1.schema.json` file layout.
   */
  readonly camSchema: JsonObject;
  /**
   * Operation Contract registry keyed by `<operationId>:v<majorVersion>`.
   * Injected so this package holds no runtime dependency on the metadata
   * registry.
   */
  readonly operationContracts: ReadonlyMap<string, JsonObject>;
}

export interface GateCheckContext {
  /** Injected clock — every timestamp emitted by the check must go through it. */
  readonly clock: () => string;
  /**
   * Application id — informational; some checks include it in evidence. Kept
   * separate from tenantId so the gate can be re-evaluated cross-tenant.
   */
  readonly appId: string;
}

/** Waiver — first-class ADR-017 artifact for the rare cases a block is accepted. */
export interface GateWaiver {
  readonly waiverId: string;
  readonly checkId: string;
  readonly reason: string;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly approverIds: readonly string[];
}

/** Verdict a single check emits. */
export interface GateCheckVerdict {
  readonly checkId: string;
  readonly checkVersion: string;
  readonly outcome: "passed" | "blocked" | "waived";
  readonly failureCode?: string;
  readonly evidence: Json;
  readonly diagnostics: readonly Diagnostic[];
  readonly evaluatedAt: string;
  readonly durationMs: number;
  readonly waiver?: GateWaiver;
}

/**
 * A GateCheck plugin. Each plugin is independently versionable and owns its
 * evidence schema and failure taxonomy per ADR-017.
 */
export interface GateCheck {
  readonly id: string;
  readonly version: string;
  readonly timeoutMs: number;
  readonly evidenceContract: JsonObject;
  readonly failureTaxonomy: readonly string[];
  evaluate(input: GateCheckInput, ctx: GateCheckContext): Promise<GateCheckVerdict>;
}

/** Aggregate GateReport — the archival artifact the pointer swap references. */
export interface GateReport {
  readonly gateReportVersion: "0.1";
  readonly id: string;
  readonly camId: string;
  readonly camVersion: string;
  readonly tenantId: string;
  readonly deploymentMode: DeploymentMode;
  readonly evaluatedAt: string;
  readonly completedAt: string;
  readonly overallOutcome: "passed" | "blocked";
  readonly verdicts: readonly GateCheckVerdict[];
  readonly prevActiveReportId?: string;
  readonly rollbackFromReportId?: string;
  /**
   * Cosign-style signatures over `reportContentHash(report)`. Empty in Phase 1
   * — signing infrastructure is a Phase 2 follow-up.
   */
  readonly signatures: readonly JsonObject[];
}

/** The 10 mandatory check ids (ADR-017 § "The Ten Mandatory Checks"). */
export const MANDATORY_CHECK_IDS = [
  "check.schema-validation",
  "check.security-validation",
  "check.privacy-validation",
  "check.accessibility-validation",
  "check.operation-contract-validation",
  "check.runtime-compatibility",
  "check.adapter-capability-coverage",
  "check.performance-budget",
  "check.ai-governance",
  "check.rollback-readiness",
] as const;

export type MandatoryCheckId = (typeof MANDATORY_CHECK_IDS)[number];

/**
 * ADR-017 forbids waivers for these two checks. Attempting to submit a waiver
 * for either MUST raise a load-time error (throw). Waiver forbidden-ness is a
 * hard invariant enforced in gate code, not in an external policy engine.
 */
export const NON_WAIVABLE_CHECK_IDS: readonly MandatoryCheckId[] = [
  "check.schema-validation",
  "check.runtime-compatibility",
];
