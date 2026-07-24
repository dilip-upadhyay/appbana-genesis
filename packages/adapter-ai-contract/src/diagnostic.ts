/**
 * Structured diagnostic — shared between AI adapters, technology adapters (ADR-014),
 * and runtime engines (ADR-013). Emitted alongside outcomes so callers can inspect
 * *why* something failed without parsing exception messages.
 *
 * @remarks
 * This is a temporary home for the shared `Diagnostic` type. In Phase 1 it will
 * migrate to a `@appbana/shared-diagnostics` package the moment a second consumer
 * (a runtime engine or the technology adapter contract) needs it. Until then,
 * duplicating the 20-line shape here is cheaper than a placeholder package.
 */

export type DiagnosticSeverity = "info" | "warn" | "error";

export interface Diagnostic {
  /** Stable machine-readable code, `UPPER_SNAKE_CASE`. Documented in the emitter's failure taxonomy. */
  readonly code: string;
  /** Human-readable message. MUST NOT contain PII. */
  readonly message: string;
  /** Diagnostic severity — `error` blocks the outcome; `warn` and `info` do not. */
  readonly severity: DiagnosticSeverity;
  /** JSON Pointer into the input document where the diagnostic applies, when meaningful. */
  readonly path?: string;
  /** Free-form structured context. Redaction is the emitter's responsibility. */
  readonly context?: Readonly<Record<string, unknown>>;
}
