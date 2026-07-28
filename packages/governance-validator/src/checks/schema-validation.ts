// check.schema-validation — REAL Phase 1 implementation.
//
// Validates the staged CAM against the injected `cam.vX.Y.schema.json`. Every
// Ajv error is mapped to a stable failure code drawn from the taxonomy below,
// letting the failure code alone drive alerting / policy without parsing the
// evidence blob.

import { compileValidator, type AjvErrorObject } from "../ajv.js";
import type {
  Diagnostic,
  GateCheck,
  GateCheckContext,
  GateCheckInput,
  GateCheckVerdict,
} from "../types.js";

export const SCHEMA_VALIDATION_ID = "check.schema-validation";
export const SCHEMA_VALIDATION_VERSION = "0.1.0";

/**
 * Stable failure codes emitted by `check.schema-validation`. Callers pattern
 * match on `verdict.failureCode` — do not add new codes without a version bump
 * of this check.
 */
export const SCHEMA_VALIDATION_FAILURE_CODES = [
  "SCHEMA_MISSING_REQUIRED_FIELD",
  "SCHEMA_TYPE_MISMATCH",
  "SCHEMA_ENUM_VIOLATION",
  "SCHEMA_PATTERN_VIOLATION",
  "SCHEMA_ADDITIONAL_PROPERTY",
  "SCHEMA_INVALID_FORMAT",
  "SCHEMA_MIN_ITEMS",
  "SCHEMA_MAX_ITEMS",
  "SCHEMA_CONST_VIOLATION",
  "SCHEMA_VALIDATION_FAILED",
  "SCHEMA_COMPILE_FAILED",
] as const;

export type SchemaValidationFailureCode =
  (typeof SCHEMA_VALIDATION_FAILURE_CODES)[number];

const FAILURE_CODE_BY_KEYWORD: Readonly<Record<string, SchemaValidationFailureCode>> = {
  required: "SCHEMA_MISSING_REQUIRED_FIELD",
  type: "SCHEMA_TYPE_MISMATCH",
  enum: "SCHEMA_ENUM_VIOLATION",
  pattern: "SCHEMA_PATTERN_VIOLATION",
  additionalProperties: "SCHEMA_ADDITIONAL_PROPERTY",
  format: "SCHEMA_INVALID_FORMAT",
  minItems: "SCHEMA_MIN_ITEMS",
  maxItems: "SCHEMA_MAX_ITEMS",
  const: "SCHEMA_CONST_VIOLATION",
};

function mapKeywordToFailure(keyword: string): SchemaValidationFailureCode {
  return FAILURE_CODE_BY_KEYWORD[keyword] ?? "SCHEMA_VALIDATION_FAILED";
}

/** JSON Schema fragment describing the evidence payload this check emits. */
const EVIDENCE_CONTRACT = {
  type: "object",
  required: ["errorCount", "errors"],
  additionalProperties: false,
  properties: {
    errorCount: { type: "integer", minimum: 0 },
    errors: {
      type: "array",
      items: {
        type: "object",
        required: ["instancePath", "keyword", "message"],
        additionalProperties: false,
        properties: {
          instancePath: { type: "string" },
          keyword: { type: "string" },
          message: { type: "string" },
          failureCode: { type: "string" },
          params: { type: "object" },
        },
      },
    },
  },
} as const;

function errorToDiagnostic(err: AjvErrorObject): Diagnostic {
  return {
    severity: "error",
    code: mapKeywordToFailure(err.keyword),
    message: err.message ?? "schema validation failed",
    path: err.instancePath,
  };
}

function errorToEvidenceEntry(err: AjvErrorObject): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    instancePath: err.instancePath,
    keyword: err.keyword,
    message: err.message ?? "",
    failureCode: mapKeywordToFailure(err.keyword),
  };
  if (err.params !== undefined) entry["params"] = err.params;
  return entry;
}

async function evaluateSchemaValidation(
  input: GateCheckInput,
  ctx: GateCheckContext,
): Promise<GateCheckVerdict> {
  const evaluatedAt = ctx.clock();
  const startMs = Date.parse(evaluatedAt);

  let errors: readonly AjvErrorObject[];
  try {
    const validate = compileValidator(input.camSchema);
    errors = validate(input.cam);
  } catch (compileErr) {
    const message =
      compileErr instanceof Error ? compileErr.message : "schema failed to compile";
    return {
      checkId: SCHEMA_VALIDATION_ID,
      checkVersion: SCHEMA_VALIDATION_VERSION,
      outcome: "blocked",
      failureCode: "SCHEMA_COMPILE_FAILED",
      evidence: {
        errorCount: 1,
        errors: [
          {
            instancePath: "",
            keyword: "compile",
            message,
            failureCode: "SCHEMA_COMPILE_FAILED",
          },
        ],
      } as unknown as import("../types.js").Json,
      diagnostics: [
        { severity: "error", code: "SCHEMA_COMPILE_FAILED", message, path: "" },
      ],
      evaluatedAt,
      durationMs: Date.parse(ctx.clock()) - startMs,
    };
  }

  if (errors.length === 0) {
    return {
      checkId: SCHEMA_VALIDATION_ID,
      checkVersion: SCHEMA_VALIDATION_VERSION,
      outcome: "passed",
      evidence: { errorCount: 0, errors: [] },
      diagnostics: [],
      evaluatedAt,
      durationMs: Date.parse(ctx.clock()) - startMs,
    };
  }

  const first = errors[0]!;
  return {
    checkId: SCHEMA_VALIDATION_ID,
    checkVersion: SCHEMA_VALIDATION_VERSION,
    outcome: "blocked",
    failureCode: mapKeywordToFailure(first.keyword),
    evidence: {
      errorCount: errors.length,
      errors: errors.map(errorToEvidenceEntry),
    } as unknown as import("../types.js").Json,
    diagnostics: errors.map(errorToDiagnostic),
    evaluatedAt,
    durationMs: Date.parse(ctx.clock()) - startMs,
  };
}

/** Factory returning the Phase 1 schema-validation GateCheck plugin. */
export function schemaValidationCheck(): GateCheck {
  return {
    id: SCHEMA_VALIDATION_ID,
    version: SCHEMA_VALIDATION_VERSION,
    timeoutMs: 30_000,
    evidenceContract: EVIDENCE_CONTRACT as unknown as Record<string, never>,
    failureTaxonomy: SCHEMA_VALIDATION_FAILURE_CODES,
    evaluate: evaluateSchemaValidation,
  };
}
