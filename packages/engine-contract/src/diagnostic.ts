// @appbana/engine-contract — Diagnostic taxonomy (ADR-013).
//
// Engines never throw for expected failure modes. Every abnormal outcome is a
// Diagnostic. Only a violated kernel invariant throws — and that is a bug, not
// a business condition.

/** Severity ladder. `error` aborts the current engine invocation. */
export type DiagnosticSeverity = "info" | "warning" | "error";

export const DIAGNOSTIC_SEVERITIES = ["info", "warning", "error"] as const;

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  /** Stable, dotted, machine-greppable. e.g. "workflow.guard.failed". */
  readonly code: string;
  readonly message: string;
  /** JSON Pointer into the sub-model or input that caused this. */
  readonly path?: string;
  /** Upstream code chain, for causal lineage in the Trace Viewer. */
  readonly cause?: string;
  readonly suggestedRemediation?: string;
}

/**
 * Diagnostic codes are dotted lowercase segments. Enforced because the Trace
 * Viewer groups and filters by code prefix — a free-form string would make
 * "show me every rules-engine failure" impossible to answer.
 */
const CODE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

/** Returns `undefined` when valid, else a human-readable reason. */
export function diagnosticViolation(value: unknown, path: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `${path} is not an object`;
  }
  const d = value as Record<string, unknown>;

  if (typeof d["severity"] !== "string" || !DIAGNOSTIC_SEVERITIES.includes(d["severity"] as DiagnosticSeverity)) {
    return `${path}.severity must be one of ${DIAGNOSTIC_SEVERITIES.join(" | ")}`;
  }
  if (typeof d["code"] !== "string" || !CODE_PATTERN.test(d["code"])) {
    return `${path}.code must be a dotted lowercase identifier (e.g. "rules.unknown-operator"), got ${JSON.stringify(d["code"])}`;
  }
  if (typeof d["message"] !== "string" || d["message"] === "") {
    return `${path}.message must be a non-empty string`;
  }
  for (const optional of ["path", "cause", "suggestedRemediation"]) {
    if (optional in d && typeof d[optional] !== "string") {
      return `${path}.${optional} must be a string when present`;
    }
  }
  return undefined;
}

/** True when any diagnostic is fatal to the invocation. */
export function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
