/**
 * Public types for `@appbana/canonical-application-generator`.
 *
 * The generator maps an AIM v0.1 document to a CAM v0.1 document per the
 * mapping table in this package's README. All CAM shapes are typed loosely as
 * `Readonly<Record<string, unknown>>` here to avoid duplicating the CAM v0.1
 * JSON Schema in TypeScript; consumers who want typed access to the generated
 * CAM should validate it with the shipped schema first.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [k: string]: Json };

export type JsonObject = { readonly [k: string]: Json };

export interface AimDocument {
  readonly aimVersion?: string;
  readonly metadata?: JsonObject;
  readonly roles?: readonly JsonObject[];
  readonly enums?: readonly JsonObject[];
  readonly entities?: readonly JsonObject[];
  readonly stateMachines?: readonly JsonObject[];
  readonly rules?: readonly JsonObject[];
  readonly operations?: readonly JsonObject[];
  readonly [k: string]: unknown;
}

export interface GeneratorInfo {
  readonly name: string;
  readonly version: string;
}

export interface GenerateCamOptions {
  /** Identity of the generator; recorded verbatim in `metadata.generator`. */
  readonly generator: GeneratorInfo;
  /** `cam.<slug>`; validated by CAM schema `camId` pattern. */
  readonly camId: string;
  /** Human release tag such as `onboarding@2026.07`. */
  readonly camReleaseTag: string;
  readonly appId: string;
  readonly tenantId?: string | null;
  readonly environment?: "dev" | "staging" | "canary" | "prod";
  /**
   * ISO-8601 datetime string. INJECTED so callers can force determinism
   * (identical `generatedAt` in → identical CAM out).
   */
  readonly generatedAt: string;
  /** `sha256:<hex>` content hash of the source AIM. */
  readonly aimContentHash: string;
  /** Optional content hash of the source BIM (recorded in provenance chain). */
  readonly bimContentHash?: string;
  /** Optional BIM version string. If omitted, defaults to "0.1.0". */
  readonly bimVersion?: string;
  /** Overrides `aim.aimVersion` when both are absent. */
  readonly aimVersion?: string;
  /** Two-part semver of the CAM envelope; default `"1.0"` per ADR-012. */
  readonly envelopeVersion?: string;
  /** Semver reported per sub-model; default `"0.1.0"`. */
  readonly subModelVersion?: string;
  /** Semver recorded in `metadataModel.appVersion`; default `"0.1.0"`. */
  readonly appVersion?: string;
}

export interface CamGeneratorDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  /** JSON Pointer into the source AIM. */
  readonly path: string;
  readonly message: string;
}

export interface GenerateCamResult {
  readonly cam: JsonObject;
  readonly diagnostics: readonly CamGeneratorDiagnostic[];
  /** `sha256:<hex>` of the canonicalized generated CAM. */
  readonly camContentHash: string;
}

/**
 * Diagnostic codes emitted by the generator. Each has a stable meaning; see the
 * README for the mapping table.
 */
export const CAM_GEN_DIAGNOSTIC_CODES = {
  EFFECT_UNMAPPED: "CAM_GEN_EFFECT_UNMAPPED",
  EXPR_UNMAPPED: "CAM_GEN_EXPR_UNMAPPED",
  AIM_SECTION_DROPPED: "CAM_GEN_AIM_SECTION_DROPPED",
  ADAPTER_INFERRED: "CAM_GEN_ADAPTER_INFERRED",
  RULE_KIND_DEFAULT: "CAM_GEN_RULE_KIND_DEFAULT",
  BOOLEAN_UNWRAPPED: "CAM_GEN_BOOLEAN_UNWRAPPED",
} as const;

export type CamGenDiagnosticCode =
  (typeof CAM_GEN_DIAGNOSTIC_CODES)[keyof typeof CAM_GEN_DIAGNOSTIC_CODES];
