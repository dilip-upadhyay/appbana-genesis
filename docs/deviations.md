# Deviation Register

Tracked departures between what the architecture documents assert and what the codebase actually does.

This file exists because the project repeatedly resolved such gaps by quietly editing the acceptance criterion rather than recording the deviation. A criterion that moves to match the implementation is not a criterion. Every entry here has an id, a cause, an owner decision, and a resolution path.

**Rules**

- A deviation is opened the moment reality and a written decision disagree — not when someone gets around to fixing it.
- Closing a deviation requires either the code changing to match the decision, or an ADR changing the decision. Editing a tracker to hide the gap is not a resolution.
- Every entry names the phase by which it must be resolved.

**Status:** `open` · `accepted` (deliberate, permanent) · `resolved`

| ID | Title | Severity | Status | Resolve by |
|---|---|---|---|---|
| [DEV-001](#dev-001) | GPT-4o adapter dropped from WS-1.2 | High | open | Phase 2 |
| [DEV-002](#dev-002) | `packages/ai-application-agent` never existed | Medium | open | Phase 1 |
| [DEV-003](#dev-003) | 8 of 10 governance gate checks are unconditional stubs | High | open | Phase 2 |
| [DEV-004](#dev-004) | ADR-013 `Omit` on a union does not distribute | Low | accepted | — |
| [DEV-005](#dev-005) | No schema→TypeScript codegen anywhere in the repo | High | open | Phase 2 |
| [DEV-006](#dev-006) | AIM cannot express screens, sections, or layout | Critical | open | Phase 1 |
| [DEV-007](#dev-007) | AIM has no index, metric, or event-kind concept | High | open | Phase 2 |
| [DEV-008](#dev-008) | `create-customer-record` effect lost at the AIM→CAM boundary | High | open | Phase 1 |
| [DEV-009](#dev-009) | ABAC id scheme diverges between generator and reference CAM | Medium | open | Phase 1 |
| [DEV-010](#dev-010) | No engine implements the ADR-013 contract | High | open | Phase 1 |
| [DEV-011](#dev-011) | Reference CAM is hand-authored, not generator output | Medium | open | Phase 1 |

---

## DEV-001

**GPT-4o adapter dropped from WS-1.2 without an ADR** · High · open · resolve by Phase 2

`execution-plan.md` and the locked decision in `.github/copilot-instructions.md` both specify the cloud tier as **Claude Sonnet 4.5 + GPT-4o**. Only the Claude and local-Llama adapters were built. The Phase 1 tracker omits the GPT-4o row entirely and declares WS-1.2 closed on the strength of "a single yaml switch flips the platform between Claude and local Llama."

The scope reduction may well be correct — but it was made by deleting a row, not by recording a decision.

*Mitigation:* the local-Llama adapter already speaks OpenAI-compatible chat completions, so the adapter is cheap to add.

**Resolution:** either build the adapter, or amend ADR-015 to state that the cloud tier is single-vendor for Phase 1 and say why.

---

## DEV-002

**`packages/ai-application-agent` is referenced in 8 files but has never existed** · Medium · open · resolve by Phase 1

Referenced as authoritative in `.github/copilot-instructions.md`, ADR-015 (twice), `architecture.md`, and `packages/README.md`. Most consequentially, `.github/instructions/ai-agents.instructions.md` sets `applyTo: "packages/ai-application-agent/**"` — **that instruction file can never activate.**

Prompts actually live in `packages/prompt-template-registry/prompts/`. The deliverable moved; the documentation did not.

**Resolution:** one ADR-015 amendment reconciling the name, then update all 8 references. Do not create the package speculatively.

---

## DEV-003

**8 of 10 mandatory governance gate checks unconditionally return `passed`** · High · open · resolve by Phase 2

`packages/governance-validator/src/checks/phase1-stubs.ts` returns `outcome: "passed"` while ignoring its input (`_input`) for: security, privacy, accessibility, runtime-compatibility, adapter-capability-coverage, performance-budget, ai-governance, and rollback-readiness.

ADR-017 declares all ten mandatory. `buildDefaultGate()` therefore emits `overallOutcome: passed` for any CAM that is schema-valid with matching operation contracts — so the kernel's fail-closed guarantee currently rests on **2 checks, not 10**.

The stub marker discipline (`phase1Stub: true`, `version: "0.0.0-phase1-stub"`) is well designed and honest. The risk is that nothing downstream inspects it: `resolveCam` does not refuse to serve on stubbed evidence.

**Resolution:** implement the remaining checks, and in the meantime make the kernel refuse `phase1Stub` evidence in any non-`dev` environment.

---

## DEV-004

**ADR-013's `Omit<EffectDescriptor, 'correlationId'>` does not distribute over a union** · Low · **accepted**

ADR-013 types the `schedule` effect's nested payload as `Omit<EffectDescriptor, 'correlationId'>`. In TypeScript, `Omit` over a union collapses to the union's *common* keys — it would erase `entity`, `eventName`, `channel`, and every other discriminated member field, leaving `{ type }`.

`packages/engine-contract/src/effect.ts` implements a distributive omit instead, which preserves each member's shape. This is plainly the ADR's intent, so it is accepted as a faithful implementation rather than raised as a change.

The implementation also forbids a `schedule` nesting another `schedule`, which ADR-013 does not address. Recursive scheduling has no bounded expansion and cannot be statically audited before the kernel applies it.

**Resolution:** none required. Fold into ADR-013 at its next revision.

---

## DEV-005

**"Schemas are the source of truth; TypeScript types are generated" is unimplemented** · High · open · resolve by Phase 2

A repo-wide search for `json-schema-to-typescript`, `quicktype`, `json2ts`, or any codegen script returns **zero matches**. There is no `generated/` directory. All hand-written `src/types.ts` files are authored by hand.

ADR-013 additionally specifies that `TraceEvent`, `EffectDescriptor`, and `Diagnostic` are generated from JSON Schemas. Only `trace-event` has a schema at all.

`packages/canonical-application-generator/src/types.ts` documents a third path the rule does not contemplate — neither generated nor duplicated, but **untyped**: `AimDocument` is `Readonly<Record<string, unknown>>`, encoding nothing from the AIM schema.

*Partial mitigation:* several packages validate against the real shipped schemas with Ajv at test time, and `@appbana/engine-contract` pins its `TraceEvent` type to `trace-event.v0.1` the same way. That catches drift, but only for values a test actually constructs.

**Resolution:** add `json-schema-to-typescript` with a CI check asserting regenerated types match committed types. Author `effect-descriptor` and `diagnostic` schemas, or amend ADR-013 to drop the generation claim for them.

---

## DEV-006

**AIM v0.1 cannot express screens, sections, or layout** · Critical · open · resolve by Phase 1

The AIM schema contains **zero** occurrences of `screen`, `section`, `layout`, or `wizard`. The reference CAM encodes a task-oriented multi-step wizard — basic-info → documents → review — with curated field grouping and progressive disclosure. None of that is expressible in AIM, so the generator falls back to a mechanical role × entity cross-product.

Verified by `packages/canonical-application-generator/__tests__/roundtrip.test.ts`: the generator drops **29 elements** in this category alone — 4 screens, 6 sections, and 19 field bindings.

This is the largest structural hole in the BIM → AIM → CAM chain, and it directly blocks the Phase 1 exit criterion of turning a conversation into a usable form.

**Resolution:** AIM v0.2 needs a presentation-intent concept, or the CAM generator needs a documented layout-inference strategy. This is an ADR-worthy decision, not an implementation detail.

---

## DEV-007

**AIM has no index, metric, or event-kind concept** · High · open · resolve by Phase 2

Two related gaps found by the round-trip test:

- AIM entities declare `keys` and `fields` but have no `indexes` member, so 4 persistence indexes in the reference CAM cannot be derived.
- AIM has no top-level `metrics` or `eventKinds`. The generator derives trace event kinds only from state-machine transitions and operations, producing the 12 domain events but none of the 5 platform-level observability declarations.

Two of the missing kinds are `event.field.rendered` and `event.rule.fired` — **exactly the two the Trace Viewer needs** to answer "why did this field appear?" and "why did this rule fire?", which `.github/copilot-instructions.md` calls the credibility proof.

**Resolution:** extend AIM, or have the Data and Observability runtimes infer these. Decide before the Trace Viewer is built.

---

## DEV-008

**`create-customer-record` effect is lost at the AIM→CAM boundary** · High · open · resolve by Phase 1

The AIM state machine declares an effect of type `create-customer-record`, which is not in the CAM v0.1 effect set. The generator drops it and emits `CAM_GEN_EFFECT_UNMAPPED` twice, so no `operation.customer.create-record` is produced.

This is real business intent being silently discarded — the exact failure the platform's thesis exists to prevent. The generator is honest about it (a diagnostic is emitted), but the intent still does not reach the running application.

**Resolution:** either the CAM effect set covers it, or AIM must express it with a supported effect. Until then, the gate should treat `CAM_GEN_EFFECT_UNMAPPED` as blocking rather than advisory.

---

## DEV-009

**ABAC id scheme diverges between generator and reference CAM** · Medium · open · resolve by Phase 1

The generator produces field-level ABAC entries named by policy intent (`abac.field-visibility-risk`, `abac.onboarding-case.risk-band`); the reference CAM names them by subject (`abac.customer.tax-identifier`, `abac.case.risk-fields`). Same coverage, different scheme.

**Resolution:** record a naming decision against ADR-012, then update one side.

---

## DEV-010

**No engine implements the ADR-013 contract** · High · open · resolve by Phase 1

`@appbana/engine-contract` now exists and is enforceable, but **zero of the eight engines are built**. `runtime-session` is a kernel-side session coordinator, not an engine.

Until at least one engine exists, the conformance suite is proven only against its own reference and negative-control fixtures.

**Resolution:** WS-1.5. The first engine should be `runtime-interaction-ui`, since it is on the critical path to the Phase 1 demo.

---

## DEV-011

**The reference CAM is hand-authored, not generator output** · Medium · open · resolve by Phase 1

`examples/customer-onboarding/cam.json` carries `metadata.generator.name === "hand-authored"`. It was written as a Phase 0 design seed, before the generator existed, and encodes design intent the pipeline cannot yet produce.

`roundtrip.test.ts` now pins the delta in both directions, so the gap can neither grow unnoticed nor go stale. But the shipped reference artifact still is not something the platform can generate.

**Resolution:** close DEV-006 through DEV-009, then regenerate `cam.json` from `aim.json` and delete the gap list.
