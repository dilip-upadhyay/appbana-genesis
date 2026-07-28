// Shared fixtures: a reference engine that is fully conformant, plus a set of
// deliberately broken engines used as negative controls.
//
// The negative controls matter more than the reference engine. A conformance
// suite that only ever sees compliant input proves nothing — it could be
// returning `conformant: true` unconditionally. Each broken engine below
// violates exactly one invariant, so a passing test proves the suite detects
// that specific violation and not merely "something".

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Diagnostic,
  EffectDescriptor,
  EngineResult,
  ExecutionContext,
  RuntimeEngine,
  TraceEvent,
  TraceSchemaValidator,
} from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(HERE, "..", "..", "..");

// Ajv ships CJS with an interop `default`; match the pattern already used in
// @appbana/runtime-session and @appbana/canonical-application-generator.
const req = createRequire(import.meta.url);
type AjvErrorList = Array<{ instancePath: string; message?: string }> | null;
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: (schema: unknown) => ((data: unknown) => boolean) & { errors?: AjvErrorList };
};
type AddFormatsFn = (ajv: unknown, opts?: unknown) => unknown;
const ajvMod = req("ajv/dist/2020.js") as { default?: AjvCtor };
const addFormatsMod = req("ajv-formats") as { default?: AddFormatsFn };
const Ajv2020 = ajvMod.default ?? (ajvMod as unknown as AjvCtor);
const addFormats = addFormatsMod.default ?? (addFormatsMod as unknown as AddFormatsFn);

export const TRACE_EVENT_SCHEMA_PATH = join(
  WORKSPACE,
  "docs",
  "schemas",
  "trace-event.v0.1.schema.json",
);

/** Compiles the real published schema. Never a hand-copied subset. */
export function createTraceSchemaValidator(): TraceSchemaValidator {
  const schema: unknown = JSON.parse(readFileSync(TRACE_EVENT_SCHEMA_PATH, "utf8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema as object);

  return (event: unknown): string | undefined => {
    if (validate(event)) return undefined;
    return (validate.errors ?? [])
      .map((e) => `${e.instancePath === "" ? "$" : e.instancePath} ${e.message ?? ""}`.trim())
      .join("; ");
  };
}

// --- The reference engine ------------------------------------------------

export interface RuleSubModel {
  readonly rules: readonly { readonly id: string; readonly whenField: string; readonly equals: string }[];
}

export interface RuleInput {
  readonly values: Readonly<Record<string, string>>;
}

export interface RuleOutput {
  readonly fired: readonly string[];
}

const RULES_VERSION = "0.1.0";

function traceEvent(
  ctx: ExecutionContext,
  eventKindRef: string,
  payload: Record<string, string | number | boolean>,
): TraceEvent {
  return {
    traceEventVersion: "0.1",
    id: uuidFrom(ctx.random),
    eventKindRef,
    occurredAt: ctx.now(),
    producedBy: { kind: "runtime-engine", engine: "runtime-rules", engineVersion: RULES_VERSION },
    traceContext: { traceId: hex(ctx.random, 32), spanId: hex(ctx.random, 16) },
    correlation: { correlationId: ctx.correlationId },
    context: {
      appId: ctx.appId,
      camId: "cam.customer-onboarding",
      camVersion: "1.0.0",
      tenantId: ctx.tenantId,
      environment: "dev",
    },
    severity: "info",
    payload,
    redactions: [],
  };
}

/** Deterministic hex from the seeded PRNG — never crypto.randomUUID(). */
function hex(random: () => number, length: number): string {
  let out = "";
  while (out.length < length) {
    out += Math.floor(random() * 0x100000000)
      .toString(16)
      .padStart(8, "0");
  }
  return out.slice(0, length);
}

function uuidFrom(random: () => number): string {
  const h = hex(random, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A minimal but genuinely conformant rules engine. */
export const referenceRulesEngine: RuntimeEngine<RuleSubModel, RuleInput, RuleOutput> = {
  engineId: "runtime-rules",
  engineVersion: RULES_VERSION,
  camSubModelId: "RuleModel",
  camSubModelVersionRange: "^0.1.0",
  capabilities: {
    supportedCamSubModelVersions: "^0.1.0",
    supportedOperationKinds: ["boolean", "comparison"],
    parallelExecution: true,
    transactional: false,
    deterministic: true,
    traceDecisionKinds: {
      "rule-evaluated": "event.rules.rule-evaluated",
      "derived-field-changed": "event.rules.derived-field-changed",
    },
  },
  execute(subModel, input, context): Promise<EngineResult<RuleOutput>> {
    const fired: string[] = [];
    const traceEvents: TraceEvent[] = [];
    const effects: EffectDescriptor[] = [];
    const diagnostics: Diagnostic[] = [];

    for (const rule of subModel.rules) {
      const actual = input.values[rule.whenField];
      if (actual === undefined) {
        diagnostics.push({
          severity: "warning",
          code: "rules.field-missing",
          message: `Rule ${rule.id} references field "${rule.whenField}" which is absent from the input.`,
          path: `/rules/${rule.id}`,
          suggestedRemediation: "Bind the field in the InteractionModel or relax the rule.",
        });
        continue;
      }
      const conditionResult = actual === rule.equals;
      traceEvents.push(
        traceEvent(context, "event.rules.rule-evaluated", {
          ruleId: rule.id,
          conditionResult,
        }),
      );
      if (conditionResult) {
        fired.push(rule.id);
        traceEvents.push(
          traceEvent(context, "event.rules.derived-field-changed", {
            ruleId: rule.id,
            field: rule.whenField,
          }),
        );
        effects.push({
          type: "emit",
          eventName: "rule.fired",
          payload: { ruleId: rule.id },
          correlationId: context.correlationId,
        });
      }
    }

    return Promise.resolve({ output: { fired }, effects, traceEvents, diagnostics });
  },
};

export const conformantFixtures = [
  {
    name: "both-rules-fire",
    subModel: {
      rules: [
        { id: "rule.kyc-required", whenField: "country", equals: "IN" },
        { id: "rule.enhanced-dd", whenField: "risk", equals: "high" },
      ],
    },
    input: { values: { country: "IN", risk: "high" } },
    expectedOutput: { fired: ["rule.kyc-required", "rule.enhanced-dd"] },
  },
  {
    name: "no-rules-fire",
    subModel: {
      rules: [{ id: "rule.kyc-required", whenField: "country", equals: "IN" }],
    },
    input: { values: { country: "GB" } },
    expectedOutput: { fired: [] },
  },
] as const;

// --- Negative controls: each breaks exactly one invariant ----------------

/** Reads the wall clock — the single most common determinism violation. */
export const nonDeterministicEngine: RuntimeEngine<RuleSubModel, RuleInput, RuleOutput> = {
  ...referenceRulesEngine,
  execute(_subModel, _input, context): Promise<EngineResult<RuleOutput>> {
    return Promise.resolve({
      output: { fired: [] },
      effects: [],
      traceEvents: [
        traceEvent(context, "event.rules.rule-evaluated", {
          // Deliberate violation: real wall clock, not context.now().
          at: new Date().toISOString() + String(Math.random()),
        }),
      ],
      diagnostics: [],
    });
  },
};

/** Returns an effect kind that is not in the closed union. */
export const adHocEffectEngine: RuntimeEngine<RuleSubModel, RuleInput, RuleOutput> = {
  ...referenceRulesEngine,
  execute(_subModel, _input, context): Promise<EngineResult<RuleOutput>> {
    return Promise.resolve({
      output: { fired: [] },
      effects: [
        { type: "send-email", to: "a@b.c", correlationId: context.correlationId } as unknown as EffectDescriptor,
      ],
      traceEvents: [],
      diagnostics: [],
    });
  },
};

/** Claims a sub-model it does not own. */
export const wrongSubModelEngine: RuntimeEngine<RuleSubModel, RuleInput, RuleOutput> = {
  ...referenceRulesEngine,
  camSubModelId: "WorkflowModel",
};

/** Throws instead of returning a diagnostic. */
export const throwingEngine: RuntimeEngine<RuleSubModel, RuleInput, RuleOutput> = {
  ...referenceRulesEngine,
  execute(): Promise<EngineResult<RuleOutput>> {
    throw new Error("boom");
  },
};

/** Emits a trace event missing W3C trace context. */
export const badTraceEngine: RuntimeEngine<RuleSubModel, RuleInput, RuleOutput> = {
  ...referenceRulesEngine,
  execute(_subModel, _input, context): Promise<EngineResult<RuleOutput>> {
    const broken = {
      traceEventVersion: "0.1",
      id: uuidFrom(context.random),
      eventKindRef: "event.rules.rule-evaluated",
      occurredAt: context.now(),
      producedBy: { kind: "runtime-engine", engine: "runtime-rules" },
      correlation: { correlationId: context.correlationId },
      context: { appId: context.appId, camId: "cam.x", camVersion: "1.0.0", environment: "dev" },
      severity: "info",
      payload: {},
    } as unknown as TraceEvent;
    return Promise.resolve({ output: { fired: [] }, effects: [], traceEvents: [broken], diagnostics: [] });
  },
};

/** Returns a non-JSON-safe output (a Date), which cannot cross a language boundary. */
export const impureOutputEngine: RuntimeEngine<RuleSubModel, RuleInput, RuleOutput> = {
  ...referenceRulesEngine,
  execute(): Promise<EngineResult<RuleOutput>> {
    return Promise.resolve({
      output: { fired: [], when: new Date() } as unknown as RuleOutput,
      effects: [],
      traceEvents: [],
      diagnostics: [],
    });
  },
};

/** Declares deterministic: false — a compile-time impossibility, forced at runtime. */
export const nonDeterministicDeclarationEngine = {
  ...referenceRulesEngine,
  capabilities: { ...referenceRulesEngine.capabilities, deterministic: false },
} as unknown as RuntimeEngine<RuleSubModel, RuleInput, RuleOutput>;

/** Never emits one of its mandated decisions. */
export const incompleteTraceEngine: RuntimeEngine<RuleSubModel, RuleInput, RuleOutput> = {
  ...referenceRulesEngine,
  execute(_subModel, _input, context): Promise<EngineResult<RuleOutput>> {
    return Promise.resolve({
      output: { fired: [] },
      effects: [],
      // Emits rule-evaluated but never derived-field-changed.
      traceEvents: [traceEvent(context, "event.rules.rule-evaluated", { ruleId: "r" })],
      diagnostics: [],
    });
  },
};
