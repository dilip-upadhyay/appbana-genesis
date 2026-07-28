import test from "node:test";
import assert from "node:assert/strict";
import { generateCam } from "../dist/index.js";
import {
  AIM_PATH,
  CAM_PATH,
  FIXED_AIM_CONTENT_HASH,
  FIXED_GENERATED_AT,
  FIXED_GENERATOR,
  readJson,
} from "./fixtures.ts";

/**
 * Round-trip coverage: AIM -> generated CAM vs. the hand-authored reference CAM.
 *
 * Before this file existed, nothing in the repo connected the generator to the
 * shipped `examples/customer-onboarding/cam.json`. The generator was tested only
 * against the CAM *schema*, while `governance-validator` and `platform-kernel`
 * were tested against the hand-committed CAM. The two could diverge forever with
 * every test green.
 *
 * The reference CAM is a Phase 0 design seed (`metadata.generator.name ===
 * "hand-authored"`), not generator output. Asserting byte equality today would be
 * dishonest: it would either fail permanently, or pressure someone into
 * overwriting the reference with current generator output — which would delete
 * the very target the generator is chasing.
 *
 * So the enforced invariant is: **no addressable element of the reference CAM is
 * silently dropped.** Everything the generator cannot yet produce is enumerated
 * below with a root cause. The test fails if that list drifts in either
 * direction, so the gap can neither grow unnoticed nor go stale.
 */

/** Why the generator cannot currently produce a given reference element. */
type GapCause =
  /** AIM v0.1 has no concept that could carry this. Needs a schema change, not generator work. */
  | "aim-model-gap"
  /** Generator produces the concept but derives a different id. Needs an id-scheme decision. */
  | "id-scheme-divergence"
  /** Business intent present in the AIM is being dropped by a mapping limitation. */
  | "intent-lost";

interface Gap {
  readonly ids: readonly string[];
  readonly cause: GapCause;
  readonly reason: string;
}

/**
 * Elements present in the hand-authored reference CAM that the deterministic
 * generator does not yet produce.
 *
 * Shrinking this list is generator (or schema) work. Growing it requires a
 * deliberate decision, because it means intent expressed in the reference is
 * being lost.
 */
const KNOWN_GAPS: readonly Gap[] = [
  {
    cause: "aim-model-gap",
    reason:
      "AIM v0.1 has no screen/section/layout concept whatsoever (the AIM schema contains zero " +
      "occurrences of screen|section|layout|wizard). The reference CAM encodes a task-oriented " +
      "multi-step wizard — basic-info -> documents -> review — with curated field grouping and " +
      "progressive disclosure. None of that design intent is expressible in the AIM, so the " +
      "generator falls back to a mechanical role x entity cross-product. This is the largest " +
      "structural hole in the BIM -> AIM -> CAM chain and it blocks the Phase 1 exit criterion " +
      "of turning a conversation into a usable form.",
    ids: [
      "screen.applicant-basic-info",
      "screen.applicant-documents",
      "screen.applicant-review",
      "screen.reviewer-case-detail",
      "section.applicant.identity",
      "section.applicant.contact",
      "section.applicant.finance",
      "section.applicant.documents",
      "section.applicant.review-summary",
      "section.reviewer.case-summary",
      "field-binding.applicant.legal-name",
      "field-binding.applicant.customer-type",
      "field-binding.applicant.country",
      "field-binding.applicant.tax-id",
      "field-binding.applicant.dob",
      "field-binding.applicant.email",
      "field-binding.applicant.phone",
      "field-binding.applicant.income",
      "field-binding.document.type",
      "field-binding.document.file",
      "field-binding.review.legal-name",
      "field-binding.review.customer-type",
      "field-binding.review.country",
      "field-binding.review.tax-id",
      "field-binding.reviewer.case-reference",
      "field-binding.reviewer.status",
      "field-binding.reviewer.risk-score",
      "field-binding.reviewer.risk-band",
      "field-binding.reviewer.decision-reason",
    ],
  },
  {
    cause: "aim-model-gap",
    reason:
      "AIM entities declare `keys` and `fields` but have no `indexes` member, so the persistence " +
      "index intent in the reference CAM cannot be derived. Either AIM gains an index concept or " +
      "the Data Runtime infers indexes from keys and observed query patterns.",
    ids: [
      "index.customer.tax-identifier",
      "index.case.reference",
      "index.case.status",
      "index.document.case-ref",
    ],
  },
  {
    cause: "aim-model-gap",
    reason:
      "AIM has no top-level `metrics` or `eventKinds` section. The generator can only derive " +
      "trace event kinds from state-machine transitions and operations, so it produces the 12 " +
      "domain events but none of the platform-level observability declarations the reference CAM " +
      "carries. `event.field.rendered` and `event.rule.fired` are exactly the two kinds the Trace " +
      "Viewer needs to answer 'why did this field appear?' and 'why did this rule fire?'.",
    ids: [
      "event.field.rendered",
      "event.rule.fired",
      "metric.case.submissions",
      "metric.case.approval-latency",
      "metric.operation.duration",
    ],
  },
  {
    cause: "id-scheme-divergence",
    reason:
      "The generator does produce field-level ABAC entries, but names them by policy intent " +
      "(`abac.field-visibility-risk`, `abac.onboarding-case.risk-band`) whereas the reference " +
      "names them by subject (`abac.case.risk-fields`). Same coverage, different id scheme. Needs " +
      "a naming decision recorded against ADR-012, then one side updated to match.",
    ids: ["abac.customer.tax-identifier", "abac.case.assigned-reviewer", "abac.case.risk-fields"],
  },
  {
    cause: "intent-lost",
    reason:
      "The AIM state machine declares an effect of type `create-customer-record`, which is not in " +
      "the CAM v0.1 effect set. The generator drops it and emits CAM_GEN_EFFECT_UNMAPPED twice, " +
      "which is why no `operation.customer.create-record` is produced. This is real business " +
      "intent being lost at the AIM->CAM boundary; either the effect set must cover it or the AIM " +
      "must express it with a supported effect.",
    ids: ["operation.customer.create-record"],
  },
];

const KNOWN_GAP_IDS = new Set(KNOWN_GAPS.flatMap((g) => g.ids));

/** Recursively collect every string `id` property in a JSON tree. */
function collectIds(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) collectIds(item, out);
    return out;
  }
  if (node !== null && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    const id = rec["id"];
    if (typeof id === "string") out.add(id);
    for (const value of Object.values(rec)) collectIds(value, out);
  }
  return out;
}

function generateFromShippedAim(): Record<string, unknown> {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, {
    generator: FIXED_GENERATOR,
    camId: "cam.customer-onboarding",
    camReleaseTag: "onboarding@2026.07",
    appId: "app.customer-onboarding",
    tenantId: null,
    environment: "dev",
    generatedAt: FIXED_GENERATED_AT,
    aimContentHash: FIXED_AIM_CONTENT_HASH,
  });
  return cam as Record<string, unknown>;
}

test("generator drops no element of the reference CAM outside the documented gap list", () => {
  const generatedIds = collectIds(generateFromShippedAim());
  const referenceIds = collectIds(readJson<Record<string, unknown>>(CAM_PATH));

  const missing = [...referenceIds].filter((id) => !generatedIds.has(id));

  const undocumented = missing
    .filter((id) => !KNOWN_GAP_IDS.has(id))
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    undocumented,
    [],
    `The generator dropped ${undocumented.length} reference element(s) not listed in KNOWN_GAPS. ` +
      "Either fix the generator or add each id with a root cause.",
  );

  const stale = [...KNOWN_GAP_IDS]
    .filter((id) => !missing.includes(id))
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    stale,
    [],
    "KNOWN_GAPS lists ids the generator now produces. Remove them so the list stays honest.",
  );
});

test("KNOWN_GAPS entries are well formed and every id belongs to the reference CAM", () => {
  const referenceIds = collectIds(readJson<Record<string, unknown>>(CAM_PATH));

  for (const gap of KNOWN_GAPS) {
    assert.ok(gap.reason.length > 40, `Gap reason too thin to be useful: ${gap.ids[0] ?? "?"}`);
    assert.ok(gap.ids.length > 0, "A gap entry must list at least one id.");
    for (const id of gap.ids) {
      assert.ok(
        referenceIds.has(id),
        `KNOWN_GAPS references '${id}', which is absent from the reference CAM.`,
      );
    }
  }

  const flat = KNOWN_GAPS.flatMap((g) => g.ids);
  assert.equal(flat.length, new Set(flat).size, "The same id is listed in more than one gap entry.");
});

test("WorkflowModel and RuleModel round-trip with no loss — they are pure business intent", () => {
  const generated = generateFromShippedAim();
  const reference = readJson<Record<string, unknown>>(CAM_PATH);

  for (const subModel of ["WorkflowModel", "RuleModel"] as const) {
    const generatedIds = collectIds(generated[subModel]);
    const missing = [...collectIds(reference[subModel])]
      .filter((id) => !generatedIds.has(id))
      .sort((a, b) => a.localeCompare(b));
    assert.deepEqual(missing, [], `${subModel} lost intent that the reference CAM expresses.`);
  }
});

test("generated CAM declares exactly the same sub-models as the reference", () => {
  const generated = generateFromShippedAim();
  const reference = readJson<Record<string, unknown>>(CAM_PATH);

  assert.equal(generated["envelopeVersion"], reference["envelopeVersion"]);

  const subModelKeys = (cam: Record<string, unknown>): string[] =>
    Object.keys(cam)
      .filter((k) => k.endsWith("Model"))
      .sort((a, b) => a.localeCompare(b));

  assert.deepEqual(subModelKeys(generated), subModelKeys(reference));
});

test("the reference CAM is still hand-authored, so equality is not yet the contract", () => {
  // Guards the premise of this file. If someone regenerates cam.json from the
  // generator, this fires and the KNOWN_GAPS mechanism should be replaced with a
  // strict deep-equality round-trip assertion.
  const reference = readJson<Record<string, unknown>>(CAM_PATH);
  const metadata = reference["metadata"] as Record<string, unknown>;
  const generator = metadata["generator"] as Record<string, unknown>;

  assert.equal(
    generator["name"],
    "hand-authored",
    "examples/customer-onboarding/cam.json is no longer hand-authored. Replace the KNOWN_GAPS " +
      "mechanism in this file with a strict deep-equality round-trip test.",
  );
});
