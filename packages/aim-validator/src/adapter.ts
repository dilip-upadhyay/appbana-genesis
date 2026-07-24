/**
 * Adapter to `@appbana/normalization-agent`'s `AimValidator` function signature.
 *
 * The normalization agent takes a `(candidate) => AimValidationResult` function
 * as an injection point. Ship a factory here so callers can drop the full
 * schema-plus-references validator into that slot without writing glue.
 *
 * `@appbana/normalization-agent` is imported for TYPES ONLY \u2014 the compiled
 * output has no runtime dependency on it (TS erases `import type`).
 */

import type {
  AimValidationError as NormalizationAgentAimValidationError,
  AimValidationResult as NormalizationAgentAimValidationResult,
  AimValidator as NormalizationAgentAimValidator,
} from "@appbana/normalization-agent";

import { validateAim } from "./validate.js";
import type {
  AimDocument,
  AimReferenceError,
  AimValidationReport,
  ValidateAimOptions,
} from "./types.js";

export function createNormalizationAgentValidator(
  options: ValidateAimOptions = {},
): NormalizationAgentAimValidator {
  return (candidate: unknown) => {
    const aim = coerceToAim(candidate);
    if (aim === undefined) {
      return {
        valid: false,
        errors: [
          {
            path: "/",
            message: `expected AIM to be a JSON object, got ${typeof candidate}`,
            keyword: "type",
          },
        ],
      } satisfies NormalizationAgentAimValidationResult;
    }
    const report = validateAim(aim, options);
    return {
      valid: report.valid,
      errors: flatten(report),
    } satisfies NormalizationAgentAimValidationResult;
  };
}

function coerceToAim(candidate: unknown): AimDocument | undefined {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }
  return candidate as AimDocument;
}

function flatten(report: AimValidationReport): NormalizationAgentAimValidationError[] {
  const out: NormalizationAgentAimValidationError[] = [];
  for (const e of report.schemaErrors) {
    const err: NormalizationAgentAimValidationError = e.detail === undefined
      ? { path: e.path, message: e.message, keyword: e.keyword }
      : { path: e.path, message: e.message, keyword: e.keyword, detail: e.detail };
    out.push(err);
  }
  for (const e of report.referenceErrors) {
    out.push(referenceErrorToAgentError(e));
  }
  for (const d of report.duplicateIds) {
    out.push({
      path: d.duplicateDefinedAt,
      message: `duplicate ${d.kind} id '${d.id}' \u2014 first defined at ${d.firstDefinedAt}`,
      keyword: "unique-id",
      detail: { id: d.id, kind: d.kind, firstDefinedAt: d.firstDefinedAt },
    });
  }
  return out;
}

function referenceErrorToAgentError(
  e: AimReferenceError,
): NormalizationAgentAimValidationError {
  const detail: Record<string, unknown> = {
    ref: e.ref,
    rule: e.rule,
    expected: e.expected,
  };
  if (e.closestSuggestion !== undefined) {
    detail["closestSuggestion"] = e.closestSuggestion;
  }
  return {
    path: e.path,
    message: e.message,
    keyword: "aim-reference",
    detail,
  };
}
