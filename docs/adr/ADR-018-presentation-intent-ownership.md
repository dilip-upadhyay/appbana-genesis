# ADR-018: Ownership of Presentation Intent

- **Status:** Accepted
- **Date:** 2026-08-06 (proposed) / 2026-08-07 (accepted)
- **Deciders:** Dilip Upadhyay
- **Consulted:** —
- **Informed:** Platform team, Phase 1 workstream owners (WS-1.3, WS-1.5, WS-1.6)

## Context and Problem Statement

The CAM `InteractionModel` fully specifies how an application presents itself: screens with titles and assigned roles, sections with headings, field bindings with controls, ordering, labels, help text, and conditional visibility. [ADR-013](ADR-013-runtime-engine-contract.md) assigns `runtime-interaction-ui` to *consume* it. [ADR-012](ADR-012-canonical-application-model-versioning.md) versions it as one of the ten sub-models.

**No ADR says who produces it.**

That silence has already been resolved in code, by default rather than by decision. The AIM v0.1 schema contains zero occurrences of `screen`, `section`, `layout`, `wizard`, `step`, `order`, or `group`. An AIM field carries `id`, `type`, `required`, `classification`, validation bounds and a role-based `visibility` block — and nothing about how a human encounters it. Yet `generateCam()` must emit a schema-valid `InteractionModel`, because the CAM schema requires `screens` with `minItems: 1`. So `buildInteractionModel()` invents one:

```
one screen  per AIM role     → id = screen.<role-slug>,  title = role.description
one section per AIM entity   → id = section.<role-slug>.<entity-slug>,  no title
one binding per entity field → order = index * 10
```

A mechanical role × entity cross-product. The hand-authored reference CAM, by contrast, encodes a task-oriented three-step applicant wizard — *basic info → documents → review* — with curated groupings ("Identity", "How can we reach you?", "Financial profile"), per-section order resets, and a separate read-only reviewer detail screen. The delta is pinned in `packages/canonical-application-generator/__tests__/roundtrip.test.ts`: **29 of the 42 dropped elements are screens, sections and field bindings**, all classified `aim-model-gap`. It is the largest structural hole in the BIM → AIM → CAM chain, and it is recorded as [DEV-006](../deviations.md).

Three things make this worse than an ordinary missing feature.

1. **The invention is invisible.** The generator produces a plausible-looking `InteractionModel` and reports no error. Nothing in the artifact says "a machine guessed this". A reviewer reading the CAM cannot distinguish a designed layout from a fallback.
2. **The invention is uncorrectable.** [ADR-011](ADR-011-bim-aim-boundary.md) guarantees that *"every translation is diffable, explainable, and reversible."* A user who dislikes the generated layout has nowhere to record the correction: BIM has no vocabulary for it, AIM has no vocabulary for it, and editing the CAM by hand breaks the provenance chain and the "business intent survives technology change" thesis.
3. **It blocks Phase 1.** The Phase 1 exit criterion is a business user going from conversation to a *usable* form in under fifteen minutes. A role × entity cross-product of every field on one screen is not a usable form for the Customer Onboarding slice, and no amount of work in `runtime-interaction-ui` or the React adapter can fix it, because the design intent never reached the CAM.

The question this ADR must answer is not "how do we make nicer forms". It is: **which artifact in the intent chain owns presentation intent, and who is allowed to author it?**

## Decision Drivers

- **[ADR-011](ADR-011-bim-aim-boundary.md) must hold for presentation as it holds for data and rules.** Whatever produces layout must be diffable, explainable and reversible. A deterministic function burying a design choice inside its source code satisfies none of the three.
- **The AIM → CAM generator must stay a pure, AI-free function of AIM + generator version.** This is the acceptance criterion the generator already ships against, and it is what makes CAM reproducible and auditable. Any solution that makes the generator "smarter" in the sense of "more opinionated" erodes it.
- **Business intent must survive technology change.** A *screen* is a web assumption. A voice channel, an IVR, a batch importer and a Java desktop client have no screens. Intent-level artifacts must not hard-code the display metaphor.
- **Zero business logic in the frontend.** Locked decision #6. The adapter renders; it does not decide.
- **Identical CAM must produce identical behaviour across adapters** (Phase 4 exit criterion: same CAM → Node.js and Java, identical behaviour). Layout cannot be an adapter-local choice.
- **Small banks first, large enterprises later.** A bank's onboarding form is a regulated artifact; its field order and grouping are reviewed and signed off. Presentation is governed content, not incidental styling.
- **Silence must become loud.** Whatever we choose, the current failure mode — a confident-looking fallback with no signal — must be impossible afterwards.

## Considered Options

1. **Option A — Teach the generator to infer layout.** Derive screens from BIM/AIM workflow stages, group fields by classification or by entity relationship, apply heuristics for ordering. Keep AIM unchanged.
2. **Option B — Presentation intent becomes a first-class part of the intent chain.** BIM gains optional business-language user journeys; AIM gains a canonical, technology-neutral `interactionFlows[]`; the generator is demoted to a pure structural projection of it.
3. **Option C — A post-CAM layout overlay.** Leave BIM/AIM alone. Add a separate, human-edited presentation artifact merged into the CAM after generation, authored in a visual layout editor.
4. **Option D — The UI adapter owns layout.** Ship a minimal CAM `InteractionModel` (a flat field list) and let each adapter decide grouping and ordering for its own medium.

### Option A — generator heuristics

The generator inspects `workflow.stages`, entity relationships and field classifications and produces a considered layout without any new vocabulary.

- **Positive:** No schema change. No new authoring burden. Ships fastest.
- **Negative:** It moves the guess without removing it. The output is still unreviewable and still uncorrectable — worse, a good heuristic is *more* convincing and therefore *less* likely to be questioned. It also fails on its own terms: the research shows BIM `workflow.stages` are process lifecycle states (`Draft`, `Submitted`, `In review`, `Approved`) and the reference wizard steps are *user journey* steps (`basic info`, `documents`, `review`). The whole applicant wizard lives inside the single stage `Draft`. There is no signal in the data to derive it from. Finally, every heuristic tweak silently rewrites the layout of every deployed application, which is exactly what CAM versioning exists to prevent.
- **Fatal objection:** It leaves the user with no way to say "no, not like that".

### Option B — presentation intent in the intent chain

Three coordinated changes:

**BIM v0.2 (optional, prose, ambiguity allowed)** gains `userJourneys[]`: named journeys with ordered steps described in business language — *"first we ask who they are, then we collect their documents, then we let them check everything before submitting"*. This is what a business user actually says, and today it is discarded.

**AIM v0.2 (canonical, zero ambiguity)** gains `interactionFlows[]`. Deliberately **not** called `screens`:

```
interactionFlow
  id            : ^flow\.[a-z][a-z0-9.-]*$
  actors[]      : roleId, minItems 1        -- who performs this flow
  purpose       : nonEmptyString            -- resolved from BIM, human-readable
  origin        : stated | agent-proposed | derived-default
  sourceBimJourney : string (optional)      -- the BIM userJourney it came from
  steps[]       : ordered, minItems 1
    id          : ^step\.[a-z][a-z0-9.-]*$
    intent      : capture | review | browse | decide | monitor
    label       : nonEmptyString
    entryWhen   : ruleRef (optional)
    groups[]    : ordered, minItems 1
      id        : ^group\.[a-z][a-z0-9.-]*$
      label     : nonEmptyString (optional)
      visibleWhen : ruleRef (optional)
      placements[] : ordered, minItems 1
        id          : ^placement\.[a-z][a-z0-9.-]*$
        entityRef   : entityId
        fieldRef    : nonEmptyString
        label       : nonEmptyString (optional)
        helpText    : nonEmptyString (optional)
        mode        : edit | read  (default edit)
        capture     : text | long-text | number | money | date | datetime
                    | boolean | choice | file   (optional)
        visibleWhen / editableWhen / requiredWhen : ruleRef (optional)
```

`step` / `group` / `intent` are medium-neutral. A step is a unit of the user's task, not a rectangle. A web adapter renders a step as a screen; a voice adapter renders it as a turn; a batch importer ignores `label` entirely and reads only the field set. This is the "intent survives technology change" thesis applied to presentation.

The same medium-neutrality governs the two properties that control how a value is supplied. `mode` says *whether* the actor may change the value at this placement; `capture` says *how* it is supplied when they may. They are orthogonal, and neither names a widget: `choice` is a dropdown on a web form and a spoken menu on an IVR; `file` is an upload on the web and an attachment in email. `capture` is optional and exists only for the cases inference cannot reach — in the entire Customer Onboarding reference it is needed exactly once, for a `string` field that holds an object-store handle.

The `intent` enum is a bijection onto the CAM's `screen.kind` (`capture`→`form`, `review`→`review`, `browse`→`list`, `decide`→`detail`, `monitor`→`dashboard`) but is named for the act rather than the display, so a channel with no screens can still honour it.

Every element carries an explicit id, including field placements. That is deliberate and consistent with the rest of the AIM, where nothing is auto-named: a placement is separately addressable so a trace event can answer *"why did this field appear **here**?"* when the same entity field is captured on one step and shown read-only on another. Deriving placement ids from group and field names instead would have made every id churn whenever a group was renamed, invalidating saved trace queries.

**The generator becomes a projection, not an author.** `buildInteractionModel()` maps `flow.step → screen`, `group → section`, `field → fieldBinding`, and derives only what is genuinely mechanical: the `control` from `field.type` + `format` (already specified and already deterministic), and `order` from array position. It invents nothing. When `interactionFlows` is absent it emits a new error-severity diagnostic `CAM_GEN_INTERACTION_FLOWS_MISSING` and falls back to the current role × entity projection stamped `origin: "generator-fallback"` in the sub-model metadata — visible, queryable, and blockable.

**The `origin` discriminator is the mechanism that satisfies ADR-011.** The agent is still allowed to design a layout the user never described — that is genuinely useful, and demanding that every business user specify field grouping would destroy the fifteen-minute demo. But when it does, it must say so (`agent-proposed`), present it back for confirmation, and record the user's edits as a diff. Guessing is not the problem. **Unattributed** guessing is.

- **Positive:** Every driver is satisfied. The generator gets *more* pure, not less. Presentation becomes reviewable, diffable, versioned and governable like every other kind of intent. The BA agent gains a concrete thing to ask about, which improves the conversation rather than lengthening it.
- **Negative:** Two schema versions to author and migrate. Real work in the normalization agent. The largest change of the four.

### Option C — post-CAM layout overlay

- **Positive:** Familiar (it is how most low-code tools work). Gives designers a direct, visual grip on the result.
- **Negative:** It creates a second source of truth outside the intent chain. The moment layout lives in an artifact that BIM and AIM do not describe, "business intent should survive technology change" becomes false for presentation: regenerate the CAM from a revised BIM and the overlay is stale, orphaned, or silently reapplied over fields that no longer exist. Provenance forks. It also inverts the product thesis — the user is back to assembling a UI by hand, which is the thing this platform exists to remove.
- **Fatal objection:** It breaks the single-chain provenance guarantee that the governance gate and Trace Viewer both depend on.

### Option D — adapter-owned layout

- **Negative:** Directly violates locked decision #6 (zero business logic in the frontend) and the Phase 4 criterion that the same CAM behaves identically on Node.js and Java. Field grouping in a regulated onboarding form is not styling; it is content subject to review. Two adapters would produce two different, both-unreviewed forms from one approved CAM.
- **Fatal objection:** Rejected on a locked decision. Recorded here for completeness only.

## Decision

**We choose Option B.**

Presentation intent is intent. It belongs in the intent chain, expressed at each layer in that layer's own vocabulary: prose user journeys in the BIM, canonical medium-neutral `interactionFlows[]` in the AIM, and a mechanical projection into the CAM `InteractionModel`. The AI agent remains the only bridge, exactly as [ADR-011](ADR-011-bim-aim-boundary.md) requires, and the AIM → CAM generator remains a pure function — it loses its power to invent, which is a strengthening of its contract, not a weakening.

The load-bearing part of this decision is not the new schema shape. It is the `origin` discriminator. The platform is *permitted* to propose a layout the user never described, because requiring a business user to specify field grouping would defeat the product. It is *not* permitted to do so silently. Every interaction flow declares whether it was stated by the user, proposed by the agent and confirmed, or mechanically derived as a last resort — and the governance gate treats those three differently. That converts today's invisible guess into a reviewable proposal.

Two boundaries are drawn explicitly, because their absence is what produced this gap:

- **AIM says what the user is trying to do and in what order; it never says how it looks.** No pixels, no widths, no columns, no themes, no CSS. `step` and `group` are units of task, not of display. Visual styling remains an adapter concern and stays outside the intent chain.
- **The generator projects; it does not design.** After this ADR, any change to `buildInteractionModel()` that produces structure not present in the AIM is a defect, not a feature.

### Rollout

Adding a *required* top-level member to AIM is a breaking change and would invalidate every existing artifact including the shipped reference AIM. So:

| Stage | AIM schema | Generator behaviour when `interactionFlows` absent | Governance gate |
|---|---|---|---|
| **AIM v0.2** (this ADR) | `interactionFlows` **optional** | `CAM_GEN_INTERACTION_FLOWS_MISSING` at severity `error`; fallback projection stamped `origin: "generator-fallback"` | `check.accessibility-validation` returns `blocked` for a `generator-fallback` InteractionModel in any non-`dev` environment |
| **AIM v1.0** | `interactionFlows` **required** | Generation fails | Unreachable |

The intermediate stage keeps the repository green and the migration honest at the same time: existing artifacts still validate, but nothing reaches production on a fallback layout. This mirrors the treatment of `phase1Stub` gate evidence in [DEV-003](../deviations.md) — the stub is allowed to exist, and is not allowed to ship.

The gate reads the target environment from the CAM's own `metadata.environment`, not from a separate gate input. There is deliberately no second place to declare it, because a check whose permissiveness is configured independently of the artifact can be talked into passing. An **absent** environment is treated as non-dev: the check fails closed, so it cannot be disabled by deletion.

### What shipped, and where it differs from the sketch above

The implementation is recorded here because three details were settled during the work and are now binding.

- **`actors[]`, not `actor`.** The reference reviewer screen is assigned to `role.reviewer`, `role.manager` and `role.auditor`. A single-actor flow could not express it, and splitting one flow into three identical copies would have made the CAM three times larger to say the same thing.
- **`intent` lost `confirm` and gained `browse`.** The original list had two intents (`confirm`, `review`) collapsing onto the CAM's single `review` kind while nothing produced `list`. A bijection removes the ambiguity about which one a projection should choose.
- **CAM v0.2 was needed too.** `InteractionModel.origin` has nowhere to live in CAM v0.1, whose `interactionModel` is `additionalProperties: false`. `docs/schemas/cam.v0.2.schema.json` adds it as an optional member with a fourth value, `generator-fallback`, which the AIM cannot produce — the AIM has no vocabulary for "the generator gave up", and it should not.

The result: the deterministic generator now reproduces the hand-authored reference `InteractionModel` **exactly** — all 4 screens, 6 sections and 19 field bindings, identical ids, titles, labels, help text, controls, ordering and conditional refs. The one remaining unreproduced element is the `messages` string bundle, which has no AIM source and is tracked separately. Before this change the generator produced a role × entity cross-product that shared not one id with the reference.

## Consequences

**Positive:**
- Closes [DEV-006](../deviations.md), the largest structural hole in the pipeline, and unblocks the Phase 1 exit criterion.
- Presentation becomes a governed artifact: versioned, diffable, content-addressed, reviewable, and covered by the publication gate — the same treatment rules and operations already receive.
- The generator's purity contract becomes stronger and mechanically checkable: it may only project.
- Medium-neutral `step`/`group` vocabulary means the Phase 3 multi-modal work and the Phase 4 Java adapter inherit a presentation model that does not assume a browser.
- The BA agent gains a concrete, bounded thing to clarify, which makes the conversation more useful rather than longer.
- `field.label` and `helpText` finally have a home in the intent chain. Today a field's user-facing label is either absent or silently copied from an undocumented AIM property.

**Negative / Costs:**
- Two schema versions (BIM v0.2, AIM v0.2) with migration, fixtures and validator updates.
- Real implementation work in the normalization agent — it must now design a first-draft layout and defend it in conversation.
- The AIM grows meaningfully larger, which increases prompt size and therefore AI cost and latency for the BIM → AIM call.
- A poor `agent-proposed` layout will now be visible to users. This is a feature, but it raises the quality bar on the prompt before the demo is credible.
- The shipped reference AIM must be extended by hand to close the 29-element gap, and the round-trip `KNOWN_GAPS` registry rewritten as the gap shrinks.

**Neutral:**
- Visual design — spacing, typography, grid, theming, responsive breakpoints — remains explicitly outside the intent chain and stays with the adapter. This ADR does not create a design system.
- The existing role × entity projection is not deleted. It is retained, renamed as an explicit fallback, and marked.
- No change to [ADR-013](ADR-013-runtime-engine-contract.md). `runtime-interaction-ui` still consumes `InteractionModel` and is unaffected by where it came from — which is the point of having a canonical model in the middle.

## Compliance / Validation

This decision is honoured only if all of the following are mechanically true. Prose agreement is not compliance. Every item below is implemented; the test that enforces it is named.

1. **Schema round-trip.** `docs/schemas/bim.v0.2.schema.json`, `aim.v0.2.schema.json` and `cam.v0.2.schema.json` are registered in `tools/validate-schemas/schemas.manifest.json` and validated against the Customer Onboarding fixtures by `pnpm validate:schemas` in CI.
2. **The gap registry shrinks, and the test proves it.** `packages/canonical-application-generator/__tests__/roundtrip.test.ts` already fails on any *undocumented* drop and on any *stale* gap id. The 29 `aim-model-gap` screen/section/binding entries have been removed from `KNOWN_GAPS`, and the existing stale-gap guard would fail if the generator did not genuinely produce them. No new test was required — the round-trip test was built for exactly this moment.
3. **The generator may not invent.** `interaction-model.test.ts` asserts three things: that the generated `InteractionModel` deep-equals the hand-authored reference; that every generated screen, section and binding id traces back to a source AIM `step`, `group` or `placement` (a structural surjection check); and that every binding resolves to a declared AIM entity field. A dangling placement produces `CAM_GEN_INTERACTION_FIELD_UNRESOLVED` at severity `error`.
4. **Fallback is loud.** `interaction-model.test.ts` asserts that generating from an AIM without `interactionFlows` yields `CAM_GEN_INTERACTION_FLOWS_MISSING` at severity `error`, and that the resulting `InteractionModel` carries `origin: "generator-fallback"`.
5. **Fallback cannot ship.** `accessibility-validation.test.ts` asserts `check.accessibility-validation` returns `blocked` for a `generator-fallback` InteractionModel in `staging`, `canary` and `prod`, `passed` with a warning diagnostic in `dev`, and `blocked` when the environment is unstated. The check also publishes the list of accessibility assertions it has *not* yet implemented, so a green verdict from a provenance-only check cannot be read as "this application is accessible".
6. **Origin is preserved end to end.** `interaction-model.test.ts` asserts `origin` reaches the CAM sub-model, and that where flows disagree the weakest claim wins — one `derived-default` flow downgrades the whole sub-model, so a guess cannot hide behind a stated journey.
7. **No display vocabulary leaks into AIM.** `interaction-model.test.ts` walks the AIM schema at every depth and fails on any property name containing `width`, `column`, `css`, `style`, `theme`, `pixel` or `grid`.

## References

- [ADR-011 — BIM ↔ AIM Boundary](ADR-011-bim-aim-boundary.md) — the diffable/explainable/reversible guarantee this ADR extends to presentation
- [ADR-012 — CAM Versioning](ADR-012-canonical-application-model-versioning.md) — `InteractionModel` sub-model versioning
- [ADR-013 — Runtime Engine Contract](ADR-013-runtime-engine-contract.md) — `runtime-interaction-ui` owns `InteractionModel` on the consuming side
- [ADR-017 — Governance Publication Gate](ADR-017-governance-publication-gate.md) — `check.accessibility-validation` is the enforcement point for the fallback ban
- [docs/deviations.md — DEV-006](../deviations.md) — the recorded gap this ADR resolves
- [docs/phase1/README.md](../phase1/README.md) — WS-1.3 (generator), WS-1.5 (UI Runtime), WS-1.6 (React adapter)
- [architecture.md](../../architecture.md) — CAM sub-model catalogue, Interaction/UI Model
- `packages/canonical-application-generator/src/interaction-model.ts` — the projection
- `packages/canonical-application-generator/__tests__/interaction-model.test.ts` — compliance checks 3, 4, 6, 7
- `packages/governance-validator/src/checks/accessibility-validation.ts` — compliance check 5
- `packages/canonical-application-generator/__tests__/roundtrip.test.ts` — the `KNOWN_GAPS` registry, now 29 entries shorter
