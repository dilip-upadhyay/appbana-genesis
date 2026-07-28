// @appbana/engine-contract — the conformance suite (ADR-013).
//
// "Any alternative engine implementation (Rust, WASM, Go) is certified by
// running the same fixture set and matching all expectations."
//
// This harness is the certification. It runs an engine against a fixture set
// and mechanically checks every invariant ADR-013 declares, returning a
// structured report rather than throwing — so a partially-conformant engine
// yields a complete list of violations instead of only its first one.

import type { Diagnostic } from "./diagnostic.js";
import { diagnosticViolation } from "./diagnostic.js";
import { effectViolation } from "./effect.js";
import type { EngineResult, ExecutionContext, RuntimeEngine } from "./engine.js";
import type { Json } from "./json.js";
import { canonicalJson, jsonViolation } from "./json.js";
import type { ExecutionContextSeed } from "./context.js";
import { createExecutionContext } from "./context.js";
import type { EngineId } from "./trace-event.js";
import {
  ENGINE_IDS,
  ENGINE_SUB_MODEL,
  MANDATED_TRACE_DECISIONS,
  traceEventViolation,
} from "./trace-event.js";

/** One fixture: a sub-model + input pair, plus the seed for the context. */
export interface ConformanceFixture<TSubModel, TInput> {
  readonly name: string;
  readonly subModel: TSubModel;
  readonly input: TInput;
  readonly contextSeed?: ExecutionContextSeed;
  /**
   * Optional expected output, compared canonically. Omit to check only the
   * structural invariants — useful while an engine is still being written.
   */
  readonly expectedOutput?: Json;
}

export type ConformanceCheckId =
  | "engine-identity"
  | "sub-model-ownership"
  | "capability-declaration"
  | "trace-decision-mapping"
  | "purity-json-safe"
  | "determinism"
  | "effect-union-membership"
  | "trace-event-envelope"
  | "trace-schema-validation"
  | "mandated-trace-completeness"
  | "diagnostic-taxonomy"
  | "no-throw-on-expected-failure"
  | "expected-output";

export interface ConformanceViolation {
  readonly check: ConformanceCheckId;
  readonly fixture?: string;
  readonly detail: string;
}

export interface ConformanceReport {
  readonly engineId: string;
  readonly engineVersion: string;
  readonly conformant: boolean;
  readonly checksRun: readonly ConformanceCheckId[];
  readonly violations: readonly ConformanceViolation[];
  readonly fixturesRun: number;
}

/**
 * An injected validator for the real trace-event JSON Schema.
 *
 * Injected rather than loaded here because the contract package performs no
 * IO — the caller compiles `docs/schemas/trace-event.v0.1.schema.json` with
 * Ajv and passes the validate function in. Keeping fs out of `src/` means this
 * package can itself run inside a WASM sandbox.
 */
export type TraceSchemaValidator = (event: unknown) => string | undefined;

export interface ConformanceOptions {
  /** Authoritative Ajv-backed trace-event validation. Strongly recommended. */
  readonly traceSchemaValidator?: TraceSchemaValidator;
  /**
   * Skip the mandated-trace-completeness check. Legitimate only while an
   * engine is under construction; CI should never set this.
   */
  readonly allowIncompleteTraceCoverage?: boolean;
}

const ENGINE_ID_SET: ReadonlySet<string> = new Set(ENGINE_IDS);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

/**
 * Certifies an engine against ADR-013.
 *
 * Every check is run for every fixture; the suite never short-circuits,
 * because an engine author fixing conformance wants the whole list.
 */
export async function runConformanceSuite<TSubModel, TInput, TOutput>(
  engine: RuntimeEngine<TSubModel, TInput, TOutput>,
  fixtures: readonly ConformanceFixture<TSubModel, TInput>[],
  options: ConformanceOptions = {},
): Promise<ConformanceReport> {
  const violations: ConformanceViolation[] = [];
  const add = (check: ConformanceCheckId, detail: string, fixture?: string): void => {
    violations.push(fixture === undefined ? { check, detail } : { check, fixture, detail });
  };

  // --- Static declarations, checked once ---------------------------------

  if (!ENGINE_ID_SET.has(engine.engineId)) {
    add(
      "engine-identity",
      `engineId "${engine.engineId}" is not one of the eight locked engine ids (${ENGINE_IDS.join(", ")})`,
    );
  }
  if (!SEMVER.test(engine.engineVersion)) {
    add("engine-identity", `engineVersion "${engine.engineVersion}" is not semver`);
  }

  const expectedSubModel = ENGINE_SUB_MODEL[engine.engineId as EngineId];
  if (expectedSubModel !== undefined && engine.camSubModelId !== expectedSubModel) {
    add(
      "sub-model-ownership",
      `engine "${engine.engineId}" declares camSubModelId "${engine.camSubModelId}" but ADR-013 locks it to "${expectedSubModel}" (1:1 ownership)`,
    );
  }

  const caps = engine.capabilities;
  if (caps === undefined || caps === null) {
    add("capability-declaration", "capabilities is missing");
  } else {
    if (caps.deterministic !== true) {
      add(
        "capability-declaration",
        "capabilities.deterministic must be true — the kernel rejects non-deterministic engines at load (ADR-013)",
      );
    }
    if (typeof caps.supportedCamSubModelVersions !== "string" || caps.supportedCamSubModelVersions === "") {
      add("capability-declaration", "capabilities.supportedCamSubModelVersions must be a non-empty semver range");
    }
    if (typeof caps.parallelExecution !== "boolean") {
      add("capability-declaration", "capabilities.parallelExecution must be a boolean");
    }
    if (typeof caps.transactional !== "boolean") {
      add("capability-declaration", "capabilities.transactional must be a boolean");
    }

    const mandated = MANDATED_TRACE_DECISIONS[engine.engineId as EngineId];
    if (mandated !== undefined) {
      for (const decision of mandated) {
        const kind = caps.traceDecisionKinds?.[decision];
        if (typeof kind !== "string" || kind === "") {
          add(
            "trace-decision-mapping",
            `capabilities.traceDecisionKinds is missing mandated decision "${decision}" — ADR-013 requires ${engine.engineId} to emit a trace event for it`,
          );
        }
      }
    }
  }

  // --- Per-fixture execution ---------------------------------------------

  const observedKinds = new Set<string>();

  for (const fixture of fixtures) {
    const first = await runOnce(engine, fixture, add);
    if (first === undefined) continue;

    // Purity: everything crossing the boundary must be JSON-safe, or a
    // cross-language engine swap silently changes behaviour.
    const outputProblem = jsonViolation(first.output, `${fixture.name}.output`);
    if (outputProblem !== undefined) {
      add("purity-json-safe", outputProblem, fixture.name);
    }

    // Effects must be members of the closed union.
    first.effects.forEach((effect, i) => {
      const problem = effectViolation(effect, `${fixture.name}.effects[${i}]`);
      if (problem !== undefined) add("effect-union-membership", problem, fixture.name);
    });

    // Diagnostics must follow the taxonomy.
    first.diagnostics.forEach((d: Diagnostic, i) => {
      const problem = diagnosticViolation(d, `${fixture.name}.diagnostics[${i}]`);
      if (problem !== undefined) add("diagnostic-taxonomy", problem, fixture.name);
    });

    // Trace events: structural envelope, then authoritative schema.
    first.traceEvents.forEach((event, i) => {
      const where = `${fixture.name}.traceEvents[${i}]`;
      const problem = traceEventViolation(event, where);
      if (problem !== undefined) {
        add("trace-event-envelope", problem, fixture.name);
        return;
      }
      observedKinds.add(event.eventKindRef);

      if (options.traceSchemaValidator !== undefined) {
        const schemaProblem = options.traceSchemaValidator(event);
        if (schemaProblem !== undefined) {
          add("trace-schema-validation", `${where}: ${schemaProblem}`, fixture.name);
        }
      }
    });

    // Determinism: same seed in, byte-identical result out.
    const second = await runOnce(engine, fixture, add);
    if (second !== undefined) {
      const a = safeCanonical(first);
      const b = safeCanonical(second);
      if (a !== undefined && b !== undefined && a !== b) {
        add(
          "determinism",
          `two runs with identically seeded contexts produced different results. This almost always means the engine read a wall clock, called Math.random(), iterated a Set/Map built from unordered input, or performed IO. First divergence: ${firstDivergence(a, b)}`,
          fixture.name,
        );
      }
    }

    if (fixture.expectedOutput !== undefined) {
      const actual = safeCanonical(first.output as Json);
      const expected = canonicalJson(fixture.expectedOutput);
      if (actual !== expected) {
        add(
          "expected-output",
          `output did not match expectation.\n  expected: ${expected}\n  actual:   ${actual ?? "<not JSON-safe>"}`,
          fixture.name,
        );
      }
    }
  }

  // --- Completeness across the whole fixture set --------------------------

  if (options.allowIncompleteTraceCoverage !== true && fixtures.length > 0) {
    const mandated = MANDATED_TRACE_DECISIONS[engine.engineId as EngineId];
    const map = engine.capabilities?.traceDecisionKinds ?? {};
    for (const decision of mandated ?? []) {
      const kind = map[decision];
      if (typeof kind === "string" && kind !== "" && !observedKinds.has(kind)) {
        add(
          "mandated-trace-completeness",
          `decision "${decision}" maps to "${kind}" but no fixture ever produced that event. ADR-013: "A conformance test that shows an engine skipping a mandated event fails the engine." Either add a fixture that exercises it, or the engine is not emitting it.`,
        );
      }
    }
  }

  const checksRun: ConformanceCheckId[] = [
    "engine-identity",
    "sub-model-ownership",
    "capability-declaration",
    "trace-decision-mapping",
    "purity-json-safe",
    "determinism",
    "effect-union-membership",
    "trace-event-envelope",
    "diagnostic-taxonomy",
    "no-throw-on-expected-failure",
  ];
  if (options.traceSchemaValidator !== undefined) checksRun.push("trace-schema-validation");
  if (options.allowIncompleteTraceCoverage !== true) checksRun.push("mandated-trace-completeness");
  if (fixtures.some((f) => f.expectedOutput !== undefined)) checksRun.push("expected-output");

  return {
    engineId: engine.engineId,
    engineVersion: engine.engineVersion,
    conformant: violations.length === 0,
    checksRun,
    violations,
    fixturesRun: fixtures.length,
  };
}

async function runOnce<TSubModel, TInput, TOutput>(
  engine: RuntimeEngine<TSubModel, TInput, TOutput>,
  fixture: ConformanceFixture<TSubModel, TInput>,
  add: (check: ConformanceCheckId, detail: string, fixture?: string) => void,
): Promise<EngineResult<TOutput> | undefined> {
  const context: ExecutionContext = createExecutionContext(fixture.contextSeed);
  try {
    const result = await engine.execute(fixture.subModel, fixture.input, context);
    if (result === undefined || result === null) {
      add("no-throw-on-expected-failure", "execute() resolved to undefined", fixture.name);
      return undefined;
    }
    for (const key of ["effects", "traceEvents", "diagnostics"] as const) {
      if (!Array.isArray(result[key])) {
        add("no-throw-on-expected-failure", `EngineResult.${key} must be an array`, fixture.name);
        return undefined;
      }
    }
    return result;
  } catch (error) {
    // ADR-013: "Engines never catch exceptions silently. Any caught exception
    // becomes a severity:'error' diagnostic." A throw that escapes execute()
    // is therefore a contract violation, not a test failure.
    add(
      "no-throw-on-expected-failure",
      `execute() threw instead of returning a diagnostic: ${error instanceof Error ? error.message : String(error)}`,
      fixture.name,
    );
    return undefined;
  }
}

function safeCanonical(value: unknown): string | undefined {
  return jsonViolation(value) === undefined ? canonicalJson(value as Json) : undefined;
}

/** Points at the first differing character, so failures are debuggable. */
function firstDivergence(a: string, b: string): string {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) {
      const from = Math.max(0, i - 40);
      return `at offset ${i}\n  run 1: …${a.slice(from, i + 40)}\n  run 2: …${b.slice(from, i + 40)}`;
    }
  }
  return `run 1 length ${a.length}, run 2 length ${b.length}`;
}

/** Formats a report for a test assertion message. */
export function formatReport(report: ConformanceReport): string {
  if (report.conformant) {
    return `${report.engineId}@${report.engineVersion} — conformant (${report.checksRun.length} checks, ${report.fixturesRun} fixtures)`;
  }
  const lines = report.violations.map(
    (v) => `  [${v.check}]${v.fixture !== undefined ? ` (${v.fixture})` : ""} ${v.detail}`,
  );
  return `${report.engineId}@${report.engineVersion} — ${report.violations.length} conformance violation(s):\n${lines.join("\n")}`;
}
