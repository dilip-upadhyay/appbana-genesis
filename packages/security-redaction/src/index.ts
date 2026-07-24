/**
 * @appbana/security-redaction
 *
 * Barrel export. Downstream packages MUST import from this entry point only.
 *
 * @see docs/adr/ADR-015-ai-model-adapter-layer.md
 * @see docs/adr/ADR-017-governance-publication-gate.md
 */

export const SECURITY_REDACTION_VERSION = "0.1.0" as const;

export { redact } from "./redact.js";
export {
  defaultRedactionRules,
  RULE_PCI_CARD,
  RULE_PII_EMAIL,
  RULE_PII_PHONE,
  RULE_PII_SSN,
} from "./default-rules.js";
export type {
  RedactionAction,
  RedactionResult,
  RedactionRule,
} from "./rules.js";
