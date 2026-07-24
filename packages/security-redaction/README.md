# @appbana/security-redaction

Rule-based input redactor shared by every AI adapter (and, later, by any runtime engine that logs user data). Runs **before** the outbound network call and emits the `AIProvenanceRedaction[]` array recorded on the provenance record.

- **Authority:** [ADR-015 § Redaction](../../docs/adr/ADR-015-ai-model-adapter-layer.md); [ADR-017 `check.privacy-validation`](../../docs/adr/ADR-017-governance-publication-gate.md).
- **Scope:** pure functions over `Record<string, unknown>`. No I/O, no network, no state.

## Model

```ts
interface RedactionRule {
  readonly id: string;                  // "rule.pii.ssn"
  readonly classification: string;      // "pii.high" (from tenant SecurityModel)
  readonly action: "removed" | "masked" | "hashed" | "truncated";
  readonly pattern: RegExp;             // MUST have the /g flag for substring rules
  readonly maskWith?: string;           // default "[REDACTED]"
  readonly policyRef?: string;          // e.g. "policy.pii-mask.v1"
}
```

Each string value in the input tree is tested against every rule. On match:

| Action | Effect on the value |
|---|---|
| `masked` | Regex substring replacement with `maskWith` (default `"[REDACTED]"`). |
| `hashed` | Regex substring replacement with `sha256:<first-16-hex>`. |
| `removed` | Whole field set to `null`. |
| `truncated` | Whole field replaced with first 4 chars + `"…"`. |

A single field may trigger multiple redactions (one per rule that fires). Every fire adds an entry to `redactions[]` with the JSON Pointer path to the field.

## Default rule set (v0.1)

- `rule.pii.ssn` — US SSN, `pii.high`, masked
- `rule.pci.card` — 13–19 digit card-like, `pci.high`, masked
- `rule.pii.email` — RFC-5322-lite, `pii.medium`, masked
- `rule.pii.phone` — US phone, `pii.medium`, masked

Callers augment / replace this set from their tenant `SecurityModel.redactionRules`.

## Usage

```ts
import { redact, defaultRedactionRules } from "@appbana/security-redaction";

const { redactedInputs, redactions } = redact(
  { message: "My SSN is 000-00-0000, email jane@example.com" },
  defaultRedactionRules,
);
// redactedInputs.message === "My SSN is [REDACTED], email [REDACTED]"
// redactions has two entries at path "/inputs/message"
```

## Non-goals

- Not a full PII/PHI scanner (see Presidio, Comprehend, etc.). This is a policy-driven regex layer, deliberately auditable.
- Not a redaction of trace events. That belongs in the observability runtime.
- Not tokenized/format-preserving encryption. Adapters that need it should compose this package with a KMS envelope.
