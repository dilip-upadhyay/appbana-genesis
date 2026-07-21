# Customer Onboarding — Reference Scenario

The first vertical slice for AppBana Genesis. Hand-authored during Phase 0 (WS-0.4), then reproduced by AI in Phase 1 as the "describe → deploy" demo.

## Files (to be authored)

| File | Description | Owner | Status |
|---|---|---|---|
| `bim.json` | Business Intent Model — business-language description of the onboarding capability | _TBD_ | ⏳ Not started |
| `aim.json` | Application Intent Model — canonical, schema-conformant | _TBD_ | ⏳ Not started |
| `cam.json` | Canonical Application Model — 10 sub-models fully populated | _TBD_ | ⏳ Not started |
| `README.md` | This file | Dilip | ✅ |

## Scope (per architecture.md § 18)

| Capability | Slice Should Prove |
|---|---|
| Business intent | Application describable as onboarding capability, roles, rules, documents, workflow |
| UI runtime | Dynamic form sections, conditional fields, validation, review screen |
| Workflow runtime | Draft, submit, review, approve/reject states |
| Rules runtime | Country/customer-type tax and document requirements |
| Operation runtime | `customer.saveDraft:v1`, `customer.validateTaxId:v1`, `document.upload:v1`, `customer.submitOnboarding:v1` |
| Data runtime | Customer, OnboardingCase, Document metadata persistence abstraction |
| Security/policy runtime | Applicant / Reviewer / Manager / Auditor differences |
| Observability | Explain why field was visible/required and which operation ran |
| AI governance | AI proposes metadata/intent patch and validation catches issues |

## Personas

- **Applicant** — creates and submits the onboarding case
- **Reviewer** — reviews submissions and requests more info
- **Manager** — approves or rejects reviewed cases
- **Auditor** — read-only access to full trail

## Key Business Rules (Phase 0 seed)

- Tax ID is required based on country + customer type (business vs individual).
- Document upload set varies by country (e.g., GST certificate for India business customers).
- High-risk applications (risk score > 7) require manager approval; low-risk auto-route to reviewer only.
- Field visibility differs by role (e.g., `internalRiskScore` visible only to Reviewer/Manager/Auditor).

## Validation

- All three artifacts must validate against their respective schemas in `docs/schemas/`.
- The Customer Onboarding CAM must be executable end-to-end by the Phase 1 minimal runtime.
- Round-trip regeneration must produce byte-identical BIM (modulo timestamps and provenance).
