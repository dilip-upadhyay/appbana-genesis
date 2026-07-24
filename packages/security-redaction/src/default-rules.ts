/**
 * Default redaction rule set for common PII / PCI patterns.
 *
 * Tenants override or extend this via their `SecurityModel.redactionRules`
 * block (see CAM Security sub-model). This set is deliberately conservative:
 * every default rule uses `action: "masked"` so an accidental match is
 * degrading, not lossy.
 */

import type { RedactionRule } from "./rules.js";

/** US Social Security Number, e.g. `123-45-6789`. */
export const RULE_PII_SSN: RedactionRule = {
  id: "rule.pii.ssn",
  classification: "pii.high",
  action: "masked",
  pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  policyRef: "policy.default-pii-mask.v1",
};

/**
 * 13–19 digit card-like sequences, with optional separators.
 * Not Luhn-checked — this is a redactor, not a validator.
 */
export const RULE_PCI_CARD: RedactionRule = {
  id: "rule.pci.card",
  classification: "pci.high",
  action: "masked",
  pattern: /\b(?:\d[ -]?){13,19}\b/g,
  policyRef: "policy.default-pci-mask.v1",
};

/** Email addresses. RFC 5322 subset; good enough for redaction. */
export const RULE_PII_EMAIL: RedactionRule = {
  id: "rule.pii.email",
  classification: "pii.medium",
  action: "masked",
  pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  policyRef: "policy.default-pii-mask.v1",
};

/** US phone numbers with optional country code. */
export const RULE_PII_PHONE: RedactionRule = {
  id: "rule.pii.phone",
  classification: "pii.medium",
  action: "masked",
  pattern: /(?<!\d)(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g,
  policyRef: "policy.default-pii-mask.v1",
};

export const defaultRedactionRules: readonly RedactionRule[] = [
  RULE_PII_SSN,
  RULE_PCI_CARD,
  RULE_PII_EMAIL,
  RULE_PII_PHONE,
];
