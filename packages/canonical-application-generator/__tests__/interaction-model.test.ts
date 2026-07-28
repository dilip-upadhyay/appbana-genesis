import test from "node:test";
import assert from "node:assert/strict";
import { generateCam } from "../dist/index.js";
import {
  AIM_PATH,
  AIM_SCHEMA_PATH,
  CAM_PATH,
  FIXED_AIM_CONTENT_HASH,
  FIXED_GENERATED_AT,
  FIXED_GENERATOR,
  readJson,
} from "./fixtures.ts";

/**
 * ADR-018 compliance — presentation intent ownership.
 *
 * ADR-018 exists because the CAM required an InteractionModel that no upstream
 * artifact owned. The generator therefore invented one from a role x entity
 * cross-product and reported no error, which meant the platform could ship a
 * layout no human had ever seen or approved while every test stayed green.
 *
 * The decision: presentation intent is intent. It belongs in the BIM (prose
 * `userJourneys`) and the AIM (`interactionFlows`), and the generator is demoted
 * from author to pure projection. These tests are the mechanical form of the
 * ADR's Compliance section — each one corresponds to a numbered check there.
 */

type Json = Record<string, unknown>;

interface Diagnostic {
  readonly severity: string;
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

interface GenerateResult {
  readonly cam: Json;
  readonly diagnostics: readonly Diagnostic[];
}

const BASE_OPTS = {
  generator: FIXED_GENERATOR,
  camId: "cam.customer-onboarding",
  camReleaseTag: "onboarding@2026.07",
  appId: "app.customer-onboarding",
  tenantId: null,
  environment: "dev",
  generatedAt: FIXED_GENERATED_AT,
  aimContentHash: FIXED_AIM_CONTENT_HASH,
} as const;

function generate(aim: Json): GenerateResult {
  return generateCam(aim, BASE_OPTS) as unknown as GenerateResult;
}

function referenceAim(): Json {
  return readJson<Json>(AIM_PATH);
}

function interactionModel(result: GenerateResult): Json {
  return result.cam["InteractionModel"] as Json;
}

/** Recursively sort object keys so two models can be compared by value, not by authoring order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((k) => [k, canonical(source[k])]),
    );
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Check 3 — the generator is a projection, not an author                      */
/* -------------------------------------------------------------------------- */

test("ADR-018 #3: the projection reproduces the hand-authored reference InteractionModel", () => {
  const generated = interactionModel(generate(referenceAim()));
  const reference = { ...(readJson<Json>(CAM_PATH)["InteractionModel"] as Json) };

  // `messages` is a localizable string bundle with no AIM source yet. It is the
  // one remaining part of the reference InteractionModel the generator cannot
  // produce, and it is tracked as a separate concern rather than smuggled in
  // here — see the message-bundle gap note below.
  delete reference["messages"];

  assert.deepEqual(
    canonical(generated),
    canonical(reference),
    "Generated InteractionModel diverged from the reference. Either the AIM interactionFlows " +
      "or the projection changed; whichever it was, the reference is the design intent and the " +
      "divergence must be justified, not absorbed.",
  );
});

test("ADR-018 #3: every generated element traces back to a source AIM element", () => {
  const aim = referenceAim();
  const model = interactionModel(generate(aim));

  const sourceIds = new Set<string>();
  for (const flow of aim["interactionFlows"] as Json[]) {
    for (const step of flow["steps"] as Json[]) {
      sourceIds.add(step["id"] as string);
      for (const group of step["groups"] as Json[]) {
        sourceIds.add(group["id"] as string);
        for (const placement of group["placements"] as Json[]) {
          sourceIds.add(placement["id"] as string);
        }
      }
    }
  }

  // The projection renames only the kind prefix: step.x -> screen.x,
  // group.x -> section.x, placement.x -> field-binding.x.
  const unsourced: string[] = [];
  const expectSourced = (generatedId: string, sourceKind: string): void => {
    const slug = generatedId.slice(generatedId.indexOf(".") + 1);
    if (!sourceIds.has(`${sourceKind}.${slug}`)) unsourced.push(generatedId);
  };

  for (const screen of model["screens"] as Json[]) {
    expectSourced(screen["id"] as string, "step");
    for (const section of screen["sections"] as Json[]) {
      expectSourced(section["id"] as string, "group");
      for (const binding of section["fields"] as Json[]) {
        expectSourced(binding["id"] as string, "placement");
      }
    }
  }

  assert.deepEqual(
    unsourced,
    [],
    "These CAM elements have no source element in the AIM. The generator authored them, " +
      "which is exactly what ADR-018 forbids.",
  );
});

test("ADR-018 #3: every generated binding resolves to a declared AIM entity field", () => {
  const aim = referenceAim();
  const declared = new Set<string>();
  for (const entity of aim["entities"] as Json[]) {
    for (const field of entity["fields"] as Json[]) {
      declared.add(`${String(entity["id"])}#${String(field["id"])}`);
    }
  }

  const model = interactionModel(generate(aim));
  const dangling: string[] = [];
  for (const screen of model["screens"] as Json[]) {
    for (const section of screen["sections"] as Json[]) {
      for (const binding of section["fields"] as Json[]) {
        const key = `${String(binding["entityRef"])}#${String(binding["fieldRef"])}`;
        if (!declared.has(key)) dangling.push(`${String(binding["id"])} -> ${key}`);
      }
    }
  }

  assert.deepEqual(dangling, [], "Field bindings point at entity fields the AIM never declares.");
});

test("a placement pointing at an undeclared field is reported, not silently rendered", () => {
  const aim = referenceAim();
  const flows = aim["interactionFlows"] as Json[];
  const firstGroup = ((flows[0]!["steps"] as Json[])[0]!["groups"] as Json[])[0]!;
  (firstGroup["placements"] as Json[]).push({
    id: "placement.applicant.does-not-exist",
    entityRef: "entity.customer",
    fieldRef: "noSuchField",
  });

  const result = generate(aim);
  const diagnostic = result.diagnostics.find(
    (d) => d.code === "CAM_GEN_INTERACTION_FIELD_UNRESOLVED",
  );

  assert.ok(diagnostic, "A dangling placement must produce a diagnostic.");
  assert.equal(diagnostic.severity, "error");
  assert.match(diagnostic.message, /noSuchField/);
});

/* -------------------------------------------------------------------------- */
/* Checks 4 and 5 — the fallback is allowed, but it is never quiet             */
/* -------------------------------------------------------------------------- */

test("ADR-018 #4: an AIM with no interactionFlows fails loudly and stamps the guess", () => {
  const aim = referenceAim();
  delete aim["interactionFlows"];

  const result = generate(aim);
  const diagnostic = result.diagnostics.find(
    (d) => d.code === "CAM_GEN_INTERACTION_FLOWS_MISSING",
  );

  assert.ok(
    diagnostic,
    "Generating an InteractionModel with no AIM source must emit CAM_GEN_INTERACTION_FLOWS_MISSING. " +
      "Silence here is the exact failure mode ADR-018 was written to stop.",
  );
  assert.equal(
    diagnostic.severity,
    "error",
    "The fallback is a guess about what a human will be shown. A warning is not proportionate.",
  );
  assert.equal(
    interactionModel(result)["origin"],
    "generator-fallback",
    "The fallback must label itself so the governance gate can refuse it.",
  );
});

test("the fallback still produces a structurally usable model — loud is not broken", () => {
  const aim = referenceAim();
  delete aim["interactionFlows"];

  const screens = interactionModel(generate(aim))["screens"] as Json[];
  assert.ok(screens.length > 0, "The fallback must still yield a schema-valid CAM.");
});

/* -------------------------------------------------------------------------- */
/* Check 6 — origin survives the whole chain                                   */
/* -------------------------------------------------------------------------- */

test("ADR-018 #6: origin survives AIM -> CAM", () => {
  const model = interactionModel(generate(referenceAim()));
  assert.equal(
    model["origin"],
    "stated",
    "The reference journeys are described in the BIM, so the CAM must say the layout was stated.",
  );
});

test("ADR-018 #6: the weakest claim wins — one guessed flow downgrades the whole sub-model", () => {
  const aim = referenceAim();
  const flows = aim["interactionFlows"] as Json[];
  flows[1]!["origin"] = "derived-default";

  assert.equal(
    interactionModel(generate(aim))["origin"],
    "derived-default",
    "A guessed flow must not be able to hide behind a stated one.",
  );
});

/* -------------------------------------------------------------------------- */
/* Check 7 — the AIM stays medium-neutral                                      */
/* -------------------------------------------------------------------------- */

test("ADR-018 #7: the AIM schema contains no display vocabulary", () => {
  // If a `width` or a `column` ever lands in the AIM, presentation intent has
  // stopped being intent and started being a layout file, and the promise that
  // the same AIM can drive a web form, a voice channel and a batch import is
  // quietly dead.
  const banned = ["width", "column", "css", "style", "theme", "pixel", "grid"];
  const schema = readJson<Json>(AIM_SCHEMA_PATH);

  const offenders: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => {
        walk(child, `${path}/${String(i)}`);
      });
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (banned.some((word) => lower.includes(word))) offenders.push(`${path}/${key}`);
      walk(value, `${path}/${key}`);
    }
  };
  walk(schema, "");

  assert.deepEqual(offenders, [], "Display vocabulary leaked into the AIM schema.");
});
