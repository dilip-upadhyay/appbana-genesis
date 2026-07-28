import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateCam } from "../dist/index.js";
import {
  AIM_PATH,
  CAM_SCHEMA_PATH,
  FIXED_AIM_CONTENT_HASH,
  FIXED_GENERATED_AT,
  FIXED_GENERATOR,
  readJson,
} from "./fixtures.ts";

const req = createRequire(import.meta.url);
const ajvMod = req("ajv/dist/2020.js") as { default?: unknown };
const addFormatsMod = req("ajv-formats") as { default?: unknown };
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: (schema: unknown) => (data: unknown) => boolean;
  errors?: Array<{ instancePath: string; message?: string }> | null;
};
const Ajv2020 = (ajvMod as { default?: AjvCtor }).default ?? (ajvMod as unknown as AjvCtor);
type AddFormatsFn = (ajv: unknown, opts?: unknown) => unknown;
const addFormats =
  (addFormatsMod as { default?: AddFormatsFn }).default ?? (addFormatsMod as unknown as AddFormatsFn);

function compileCamValidator(): (data: unknown) => { valid: boolean; errors: unknown[] } {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const schema = readJson(CAM_SCHEMA_PATH);
  const validate = ajv.compile(schema);
  return (data) => {
    const valid = validate(data);
    // Ajv attaches errors to the compiled validator, falling back to the
    // instance for compile-time errors. Both are nulled between runs.
    const fromValidator = (validate as unknown as { errors?: unknown[] | null }).errors;
    const errors = fromValidator ?? ajv.errors ?? [];
    return { valid, errors: errors as unknown[] };
  };
}

function baseOptions(overrides: Partial<Parameters<typeof generateCam>[1]> = {}): Parameters<typeof generateCam>[1] {
  return {
    generator: FIXED_GENERATOR,
    camId: "cam.customer-onboarding",
    camReleaseTag: "onboarding@2026.07",
    appId: "app.customer-onboarding",
    tenantId: null,
    environment: "dev",
    generatedAt: FIXED_GENERATED_AT,
    aimContentHash: FIXED_AIM_CONTENT_HASH,
    ...overrides,
  };
}

test("generates a CAM envelope with all 10 sub-models from the shipped AIM", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  assert.equal(cam["envelopeVersion"], "1.0");
  const meta = cam["metadata"] as Record<string, unknown>;
  assert.equal(meta["camId"], "cam.customer-onboarding");
  for (const slot of [
    "InteractionModel",
    "WorkflowModel",
    "RuleModel",
    "OperationModel",
    "DataModel",
    "IntegrationModel",
    "SecurityModel",
    "ObservabilityModel",
    "DeploymentModel",
    "MetadataModel",
  ]) {
    assert.ok(cam[slot] !== undefined, `expected slot ${slot}`);
  }
});

test("generated CAM validates against cam.v0.1 JSON Schema", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const validate = compileCamValidator();
  const result = validate(cam);
  if (!result.valid) {
    console.error("CAM validation errors:", JSON.stringify(result.errors, null, 2).slice(0, 4000));
  }
  assert.equal(result.valid, true, "generated CAM must validate against cam.v0.1 schema");
});

test("adapter for save-draft (persist only) is data + primary entity binding", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const ops = (cam["OperationModel"] as { operations: Array<Record<string, unknown>> }).operations;
  const saveDraft = ops.find((o) => o["id"] === "operation.customer.save-draft")!;
  assert.deepEqual(saveDraft["adapter"], { kind: "data", binding: "entity.customer" });
});

test("adapter for document.upload (object-store:put) is storage", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const ops = (cam["OperationModel"] as { operations: Array<Record<string, unknown>> }).operations;
  const upload = ops.find((o) => o["id"] === "operation.document.upload")!;
  assert.deepEqual(upload["adapter"], { kind: "storage", binding: "object-store:default" });
});

test("adapter for validate-tax-id (pure, empty side effects) is internal kernel:pure-eval", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const ops = (cam["OperationModel"] as { operations: Array<Record<string, unknown>> }).operations;
  const validate = ops.find((o) => o["id"] === "operation.customer.validate-tax-id")!;
  assert.deepEqual(validate["adapter"], { kind: "internal", binding: "kernel:pure-eval" });
});

test("guard shorthand {ref: rule.x} on operations rewrites to guardRef", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const ops = (cam["OperationModel"] as { operations: Array<Record<string, unknown>> }).operations;
  const submit = ops.find((o) => o["id"] === "operation.customer.submit-onboarding")!;
  assert.equal(submit["guardRef"], "rule.submission-completeness");
  assert.equal(submit["guard"], undefined);
});

test("guard shorthand on transitions rewrites to guardRef", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const sms = (cam["WorkflowModel"] as { stateMachines: Array<Record<string, unknown>> }).stateMachines;
  const sm = sms[0]!;
  const transitions = sm["transitions"] as Array<Record<string, unknown>>;
  const submit = transitions.find((t) => t["id"] === "t.submit")!;
  assert.equal(submit["guardRef"], "rule.submission-completeness");
  assert.equal(submit["guard"], undefined);
});

test("emit-trace effect gets event. prefix on eventKindRef", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const sms = (cam["WorkflowModel"] as { stateMachines: Array<Record<string, unknown>> }).stateMachines;
  const sm = sms[0]!;
  const submit = (sm["transitions"] as Array<Record<string, unknown>>).find((t) => t["id"] === "t.submit")!;
  const effects = submit["effects"] as Array<Record<string, unknown>>;
  const emit = effects.find((e) => e["type"] === "emit-trace")!;
  assert.equal(emit["eventKindRef"], "event.case.submitted");
});

test("field-visibility rule synthesises when/then wrapper", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const rules = (cam["RuleModel"] as { rules: Array<Record<string, unknown>> }).rules;
  const rule = rules.find((r) => r["id"] === "rule.field-visibility-risk")!;
  assert.deepEqual(rule["when"], { op: "always" });
  const then = (rule as Record<string, unknown>)["then"] as Array<Record<string, unknown>>;
  assert.equal(then[0]!["action"], "set-visibility");
});

test("require-documents action renames `types` to `documentTypes`", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const rules = (cam["RuleModel"] as { rules: Array<Record<string, unknown>> }).rules;
  const rule = rules.find((r) => r["id"] === "rule.documents-by-country")!;
  const cases = rule["cases"] as Array<Record<string, unknown>>;
  const firstCase = cases[0]!;
  const then = firstCase["then"] as Array<Record<string, unknown>>;
  const requireDocs = then[0]!;
  assert.equal(requireDocs["action"], "require-documents");
  assert.ok(Array.isArray(requireDocs["documentTypes"]));
  assert.equal(requireDocs["types"], undefined);
});

test("mimeType field (enum with enumRef=null) is narrowed to type=string", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const entities = (cam["DataModel"] as { entities: Array<Record<string, unknown>> }).entities;
  const doc = entities.find((e) => e["id"] === "entity.document")!;
  const fields = doc["fields"] as Array<Record<string, unknown>>;
  const mime = fields.find((f) => f["id"] === "mimeType")!;
  assert.equal(mime["type"], "string");
  assert.equal(mime["enumRef"], undefined);
});

test("currency='resolved-at-runtime' is normalised to 'USD'", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { cam } = generateCam(aim, baseOptions());
  const entities = (cam["DataModel"] as { entities: Array<Record<string, unknown>> }).entities;
  const cust = entities.find((e) => e["id"] === "entity.customer")!;
  const fields = cust["fields"] as Array<Record<string, unknown>>;
  const income = fields.find((f) => f["id"] === "declaredAnnualIncomeOrTurnover")!;
  assert.equal(income["currency"], "USD");
});

test("create-customer-record effect on approve is dropped with EFFECT_UNMAPPED", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { diagnostics } = generateCam(aim, baseOptions());
  const dropped = diagnostics.filter((d) => d.code === "CAM_GEN_EFFECT_UNMAPPED");
  assert.ok(dropped.length >= 1);
});

test("dropped AIM sections emit CAM_GEN_AIM_SECTION_DROPPED diagnostics", () => {
  const aim = readJson<Parameters<typeof generateCam>[0]>(AIM_PATH);
  const { diagnostics } = generateCam(aim, baseOptions());
  const sections = diagnostics
    .filter((d) => d.code === "CAM_GEN_AIM_SECTION_DROPPED")
    .map((d) => d.path);
  assert.ok(sections.includes("/nonFunctional"));
  assert.ok(sections.includes("/traceability"));
  assert.ok(sections.includes("/openIssues"));
  assert.ok(sections.includes("/documents"));
});
