/**
 * Rule and result shapes for the redaction engine.
 *
 * Traces to ADR-015 § Redaction. The emitted `redactions[]` array is copied
 * verbatim onto `AIProvenanceRecord.redactions` by AI adapters.
 */

import type { AIProvenanceRedaction } from "@appbana/adapter-ai-contract";

/** Actions available on match. Mirrors {@link import("@appbana/adapter-ai-contract").AIRedactionAction}. */
export type RedactionAction = "removed" | "masked" | "hashed" | "truncated";

export interface RedactionRule {
  /** Stable identifier, e.g. `"rule.pii.ssn"`. Used in diagnostics and audit trails. */
  readonly id: string;
  /** Classification label from the tenant `SecurityModel.dataClassifications`. */
  readonly classification: string;
  readonly action: RedactionAction;
  /**
   * Regex used to detect the sensitive substring. MUST include the `/g` flag
   * for `masked` and `hashed` actions (they run string.replace globally).
   */
  readonly pattern: RegExp;
  /** Replacement for `masked` action. Defaults to `"[REDACTED]"`. */
  readonly maskWith?: string;
  /** Optional reference into the policy that authorised the rule. */
  readonly policyRef?: string;
}

export interface RedactionResult {
  readonly redactedInputs: Readonly<Record<string, unknown>>;
  readonly redactions: readonly AIProvenanceRedaction[];
}
