/**
 * The 16 conformance checks defined by v0.1 of this suite.
 *
 * Each check is a small function operating over the pre-initialised
 * adapter and a set of fixtures the runner has already built. Checks
 * MUST NOT throw — the runner wraps them defensively, but returning a
 * structured outcome keeps failure reasons legible.
 */

import type {
  AIAdapterCapabilities,
  AIConformanceTier,
  AIInvocationContext,
  AIInvocationRequest,
  AIInvocationResult,
  AIModelAdapter,
  AIProvenanceRecord,
  Diagnostic,
} from "@appbana/adapter-ai-contract";

import type { ConformanceCheckId } from "./report.js";
import { isSha256Hex } from "./hashing.js";

/**
 * Fixtures the runner assembles before check execution. All are optional
 * except `happyPathRequest` and `invocationContext`; missing fixtures cause
 * the dependent check(s) to be reported skipped.
 */
export interface ConformanceFixtures {
  readonly invocationContext: AIInvocationContext;
  readonly happyPathRequest: AIInvocationRequest;
  readonly abortRequest?: AIInvocationRequest;
  readonly budgetBreachRequest?: AIInvocationRequest;
  readonly unsupportedContractRequest?: AIInvocationRequest;
  /** Two requests carrying identical seeds and inputs. */
  readonly deterministicSeededRequests?: readonly [
    AIInvocationRequest,
    AIInvocationRequest,
  ];
  readonly redactionRequest?: AIInvocationRequest;
  /**
   * JSON Pointer paths that MUST appear in `provenance.redactions[*].path` when
   * `redactionRequest` is used. Empty array = at least one redaction of any path.
   */
  readonly expectedRedactionPaths?: readonly string[];
}

export interface CheckContext {
  readonly adapter: AIModelAdapter;
  readonly capabilities: AIAdapterCapabilities;
  readonly fixtures: ConformanceFixtures;
  /** Populated by the runner before any check executes. Undefined if the invoke threw. */
  readonly happyPathResult: AIInvocationResult | undefined;
  /** Set by the runner if the pre-check happy-path invoke threw. */
  readonly happyPathError: unknown;
}

export type CheckOutcome =
  | {
      readonly passed: true;
      readonly reason?: string;
      readonly diagnostics?: readonly Diagnostic[];
    }
  | {
      readonly passed: false;
      readonly reason: string;
      readonly diagnostics?: readonly Diagnostic[];
    }
  | { readonly skipped: true; readonly reason: string };

export interface Check {
  readonly id: ConformanceCheckId;
  readonly title: string;
  readonly tier: AIConformanceTier;
  readonly run: (ctx: CheckContext) => Promise<CheckOutcome>;
}

// ---------------------------------------------------------------------------
// Tier ordering helper
// ---------------------------------------------------------------------------

const TIER_RANK: Readonly<Record<AIConformanceTier, number>> = {
  C: 1,
  B: 2,
  A: 3,
};

/**
 * True iff the requested `target` tier includes checks belonging to `checkTier`.
 * Tier ordering is a superset chain: A ⊇ B ⊇ C.
 */
export function tierIncludes(
  target: AIConformanceTier,
  checkTier: AIConformanceTier,
): boolean {
  return TIER_RANK[target] >= TIER_RANK[checkTier];
}

// ---------------------------------------------------------------------------
// Provenance shape validation (shared by C.6 and internal reuse)
// ---------------------------------------------------------------------------

function validateProvenanceShape(p: AIProvenanceRecord): string | undefined {
  if (p.aiProvenanceVersion !== "0.1") {
    return `aiProvenanceVersion must be "0.1", got ${JSON.stringify(p.aiProvenanceVersion)}`;
  }
  const requiredStrings: readonly (keyof AIProvenanceRecord)[] = [
    "modelBinding",
    "modelName",
    "modelVersion",
    "promptTemplateRef",
    "promptTemplateVersion",
    "requestedAt",
    "completedAt",
    "requestingAgent",
  ];
  for (const key of requiredStrings) {
    if (typeof p[key] !== "string" || (p[key] as string).length === 0) {
      return `provenance.${String(key)} must be a non-empty string`;
    }
  }
  if (!isSha256Hex(p.promptTemplateHash)) {
    return `provenance.promptTemplateHash must match sha256:<hex>, got ${p.promptTemplateHash}`;
  }
  if (!isSha256Hex(p.inputHash)) {
    return `provenance.inputHash must match sha256:<hex>, got ${p.inputHash}`;
  }
  if (!isSha256Hex(p.outputHash)) {
    return `provenance.outputHash must match sha256:<hex>, got ${p.outputHash}`;
  }
  const tu = p.tokenUsage;
  if (
    typeof tu.input !== "number" ||
    typeof tu.output !== "number" ||
    typeof tu.total !== "number"
  ) {
    return "provenance.tokenUsage fields must be numbers";
  }
  if (tu.input + tu.output !== tu.total) {
    return `provenance.tokenUsage.total (${tu.total}) must equal input+output (${tu.input + tu.output})`;
  }
  if (typeof p.wallClockMs !== "number" || p.wallClockMs < 0) {
    return `provenance.wallClockMs must be a non-negative number, got ${p.wallClockMs}`;
  }
  if (!Array.isArray(p.redactions)) {
    return "provenance.redactions must be an array";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tier C — Contract shape (7 checks)
// ---------------------------------------------------------------------------

const check_C_1: Check = {
  id: "C.1",
  title: "adapter.kind matches capabilities.kind",
  tier: "C",
  async run({ adapter, capabilities }) {
    if (adapter.kind !== capabilities.kind) {
      return {
        passed: false,
        reason: `adapter.kind (${adapter.kind}) !== capabilities.kind (${capabilities.kind})`,
      };
    }
    return { passed: true };
  },
};

const check_C_2: Check = {
  id: "C.2",
  title: "adapter.binding matches capabilities.binding",
  tier: "C",
  async run({ adapter, capabilities }) {
    if (adapter.binding !== capabilities.binding) {
      return {
        passed: false,
        reason: `adapter.binding (${adapter.binding}) !== capabilities.binding (${capabilities.binding})`,
      };
    }
    if (!adapter.binding.startsWith("ai:")) {
      return {
        passed: false,
        reason: `adapter.binding must begin with "ai:", got ${adapter.binding}`,
      };
    }
    return { passed: true };
  },
};

const check_C_3: Check = {
  id: "C.3",
  title: "capabilities.supportedResponseContracts is non-empty",
  tier: "C",
  async run({ capabilities }) {
    if (capabilities.supportedResponseContracts.length === 0) {
      return {
        passed: false,
        reason: "capabilities.supportedResponseContracts must have at least one entry",
      };
    }
    return { passed: true };
  },
};

const check_C_4: Check = {
  id: "C.4",
  title: "init → invoke → shutdown completes on happy path",
  tier: "C",
  async run({ happyPathResult, happyPathError }) {
    if (happyPathError !== undefined) {
      return {
        passed: false,
        reason: `happy-path invoke threw: ${errString(happyPathError)}`,
      };
    }
    if (happyPathResult === undefined) {
      return { passed: false, reason: "happy-path result was undefined" };
    }
    if (happyPathResult.outcome !== "accepted") {
      return {
        passed: false,
        reason: `expected outcome "accepted", got "${happyPathResult.outcome}"`,
        diagnostics: happyPathResult.diagnostics,
      };
    }
    return { passed: true };
  },
};

const check_C_5: Check = {
  id: "C.5",
  title: "health() returns a valid AIAdapterHealth",
  tier: "C",
  async run({ adapter }) {
    let health;
    try {
      health = await adapter.health();
    } catch (err) {
      return { passed: false, reason: `health() threw: ${errString(err)}` };
    }
    if (
      health === null ||
      typeof health !== "object" ||
      !("state" in health) ||
      !("summary" in health) ||
      !("checkedAt" in health)
    ) {
      return {
        passed: false,
        reason: "health() must return { state, summary, checkedAt }",
      };
    }
    const validStates = ["healthy", "degraded", "unhealthy"];
    if (!validStates.includes(health.state)) {
      return {
        passed: false,
        reason: `health.state must be one of ${validStates.join("|")}, got ${health.state}`,
      };
    }
    if (typeof health.summary !== "string" || health.summary.length === 0) {
      return { passed: false, reason: "health.summary must be a non-empty string" };
    }
    if (
      typeof health.checkedAt !== "string" ||
      Number.isNaN(Date.parse(health.checkedAt))
    ) {
      return {
        passed: false,
        reason: "health.checkedAt must be an ISO-8601 timestamp",
      };
    }
    return { passed: true };
  },
};

const check_C_6: Check = {
  id: "C.6",
  title: "happy-path provenance record passes shape + hash checks",
  tier: "C",
  async run({ happyPathResult }) {
    if (happyPathResult === undefined) {
      return { passed: false, reason: "prerequisite C.4 did not produce a result" };
    }
    const problem = validateProvenanceShape(happyPathResult.provenance);
    if (problem !== undefined) {
      return { passed: false, reason: problem };
    }
    return { passed: true };
  },
};

const check_C_7: Check = {
  id: "C.7",
  title: "correlationId is echoed onto the result",
  tier: "C",
  async run({ happyPathResult, fixtures }) {
    if (happyPathResult === undefined) {
      return { passed: false, reason: "prerequisite C.4 did not produce a result" };
    }
    if (happyPathResult.correlationId !== fixtures.happyPathRequest.correlationId) {
      return {
        passed: false,
        reason: `expected correlationId ${fixtures.happyPathRequest.correlationId}, got ${happyPathResult.correlationId}`,
      };
    }
    return { passed: true };
  },
};

// ---------------------------------------------------------------------------
// Tier B — Behavior (5 checks)
// ---------------------------------------------------------------------------

const check_B_1: Check = {
  id: "B.1",
  title: "aborted invocation returns quickly with outcome !== \"accepted\"",
  tier: "B",
  async run({ adapter, fixtures }) {
    const request = fixtures.abortRequest ?? fixtures.happyPathRequest;
    const controller = new AbortController();
    controller.abort();
    const ctx: AIInvocationContext = {
      ...fixtures.invocationContext,
      signal: controller.signal,
    };
    const start = Date.now();
    let result: AIInvocationResult;
    try {
      result = await adapter.invoke(request, ctx);
    } catch (err) {
      return {
        passed: false,
        reason: `adapter threw on aborted request; must return an outcome instead: ${errString(err)}`,
      };
    }
    const elapsedMs = Date.now() - start;
    if (result.outcome === "accepted") {
      return {
        passed: false,
        reason: "aborted invocation returned outcome=\"accepted\"; expected a non-accepted terminal outcome",
      };
    }
    if (elapsedMs > 5_000) {
      return {
        passed: false,
        reason: `aborted invocation took ${elapsedMs}ms to return; expected <5000ms`,
      };
    }
    return { passed: true };
  },
};

const check_B_2: Check = {
  id: "B.2",
  title: "unsupported response contract returns diagnostic (does not throw)",
  tier: "B",
  async run({ adapter, fixtures }) {
    if (fixtures.unsupportedContractRequest === undefined) {
      return {
        skipped: true,
        reason: "adapter supports every response contract; nothing unsupported to test",
      };
    }
    let result: AIInvocationResult;
    try {
      result = await adapter.invoke(
        fixtures.unsupportedContractRequest,
        fixtures.invocationContext,
      );
    } catch (err) {
      return {
        passed: false,
        reason: `adapter threw on unsupported contract; must return outcome instead: ${errString(err)}`,
      };
    }
    if (result.outcome === "accepted") {
      return {
        passed: false,
        reason: "adapter returned outcome=\"accepted\" for an unsupported response contract",
      };
    }
    if (result.diagnostics.length === 0) {
      return {
        passed: false,
        reason: "adapter returned a non-accepted outcome for an unsupported contract but emitted zero diagnostics",
      };
    }
    return { passed: true };
  },
};

const check_B_3: Check = {
  id: "B.3",
  title: "budget breach returns outcome=\"budget-exceeded\"",
  tier: "B",
  async run({ adapter, capabilities, fixtures }) {
    if (
      capabilities.costPerInputToken === undefined ||
      capabilities.costPerOutputToken === undefined
    ) {
      return {
        skipped: true,
        reason: "adapter does not declare cost fields; budget enforcement is not required",
      };
    }
    if (fixtures.budgetBreachRequest === undefined) {
      return {
        skipped: true,
        reason: "no budgetBreachRequest fixture supplied to the runner",
      };
    }
    let result: AIInvocationResult;
    try {
      result = await adapter.invoke(
        fixtures.budgetBreachRequest,
        fixtures.invocationContext,
      );
    } catch (err) {
      return {
        passed: false,
        reason: `adapter threw on budget-breaching request: ${errString(err)}`,
      };
    }
    if (result.outcome !== "budget-exceeded") {
      return {
        passed: false,
        reason: `expected outcome "budget-exceeded", got "${result.outcome}"`,
      };
    }
    return { passed: true };
  },
};

const check_B_4: Check = {
  id: "B.4",
  title: "provenance.requestedAt <= provenance.completedAt",
  tier: "B",
  async run({ happyPathResult }) {
    if (happyPathResult === undefined) {
      return { passed: false, reason: "prerequisite C.4 did not produce a result" };
    }
    const p = happyPathResult.provenance;
    const requested = Date.parse(p.requestedAt);
    const completed = Date.parse(p.completedAt);
    if (Number.isNaN(requested) || Number.isNaN(completed)) {
      return {
        passed: false,
        reason: `unparseable timestamp — requestedAt=${p.requestedAt} completedAt=${p.completedAt}`,
      };
    }
    if (requested > completed) {
      return {
        passed: false,
        reason: `requestedAt (${p.requestedAt}) is after completedAt (${p.completedAt})`,
      };
    }
    return { passed: true };
  },
};

const check_B_5: Check = {
  id: "B.5",
  title: "supportsStreaming === true iff adapter.invokeStream is defined",
  tier: "B",
  async run({ adapter, capabilities }) {
    const hasStream = typeof adapter.invokeStream === "function";
    if (capabilities.supportsStreaming !== hasStream) {
      return {
        passed: false,
        reason: `capabilities.supportsStreaming=${capabilities.supportsStreaming} but adapter.invokeStream ${hasStream ? "is" : "is not"} defined`,
      };
    }
    return { passed: true };
  },
};

// ---------------------------------------------------------------------------
// Tier A — Policy (4 checks)
// ---------------------------------------------------------------------------

const check_A_1: Check = {
  id: "A.1",
  title: "requiresNetwork === false implies egressesInputsToThirdParty === false",
  tier: "A",
  async run({ capabilities }) {
    if (
      capabilities.requiresNetwork === false &&
      capabilities.egressesInputsToThirdParty === true
    ) {
      return {
        passed: false,
        reason: "capabilities declare requiresNetwork=false but egressesInputsToThirdParty=true; air-gapped invariant is broken",
      };
    }
    return { passed: true };
  },
};

const check_A_2: Check = {
  id: "A.2",
  title: "same seed produces same outputHash",
  tier: "A",
  async run({ adapter, capabilities, fixtures }) {
    if (capabilities.supportsDeterminismHint === false) {
      return {
        skipped: true,
        reason: "adapter does not declare supportsDeterminismHint",
      };
    }
    if (fixtures.deterministicSeededRequests === undefined) {
      return {
        skipped: true,
        reason: "no deterministicSeededRequests fixture supplied to the runner",
      };
    }
    const [req1, req2] = fixtures.deterministicSeededRequests;
    let resultA: AIInvocationResult;
    let resultB: AIInvocationResult;
    try {
      resultA = await adapter.invoke(req1, fixtures.invocationContext);
      resultB = await adapter.invoke(req2, fixtures.invocationContext);
    } catch (err) {
      return {
        passed: false,
        reason: `seeded invoke threw: ${errString(err)}`,
      };
    }
    if (resultA.outcome !== "accepted" || resultB.outcome !== "accepted") {
      return {
        passed: false,
        reason: `seeded invokes did not both succeed (A=${resultA.outcome} B=${resultB.outcome})`,
      };
    }
    if (resultA.provenance.outputHash !== resultB.provenance.outputHash) {
      return {
        passed: false,
        reason: `same seed produced different outputHash: ${resultA.provenance.outputHash} vs ${resultB.provenance.outputHash}`,
      };
    }
    return { passed: true };
  },
};

const check_A_3: Check = {
  id: "A.3",
  title: "classified inputs surface in provenance.redactions[]",
  tier: "A",
  async run({ adapter, fixtures }) {
    if (fixtures.redactionRequest === undefined) {
      return {
        skipped: true,
        reason: "no redactionRequest fixture supplied to the runner",
      };
    }
    let result: AIInvocationResult;
    try {
      result = await adapter.invoke(
        fixtures.redactionRequest,
        fixtures.invocationContext,
      );
    } catch (err) {
      return {
        passed: false,
        reason: `redaction invoke threw: ${errString(err)}`,
      };
    }
    if (result.provenance.redactions.length === 0) {
      return {
        passed: false,
        reason: "adapter processed a classified input but emitted zero redactions",
      };
    }
    const expected = fixtures.expectedRedactionPaths ?? [];
    for (const path of expected) {
      if (!result.provenance.redactions.some((r) => r.path === path)) {
        return {
          passed: false,
          reason: `expected redaction at path "${path}" not present`,
        };
      }
    }
    return { passed: true };
  },
};

const check_A_4: Check = {
  id: "A.4",
  title: "provenance.modelProviderRegion matches capabilities.dataResidencyGuarantee",
  tier: "A",
  async run({ capabilities, happyPathResult }) {
    if (capabilities.dataResidencyGuarantee === undefined) {
      return {
        skipped: true,
        reason: "capabilities do not declare dataResidencyGuarantee",
      };
    }
    if (happyPathResult === undefined) {
      return { passed: false, reason: "prerequisite C.4 did not produce a result" };
    }
    const region = happyPathResult.provenance.modelProviderRegion;
    if (region !== capabilities.dataResidencyGuarantee) {
      return {
        passed: false,
        reason: `provenance.modelProviderRegion (${region ?? "undefined"}) !== capabilities.dataResidencyGuarantee (${capabilities.dataResidencyGuarantee})`,
      };
    }
    return { passed: true };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All 16 checks in stable execution order. */
export const conformanceChecks: readonly Check[] = [
  check_C_1,
  check_C_2,
  check_C_3,
  check_C_4,
  check_C_5,
  check_C_6,
  check_C_7,
  check_B_1,
  check_B_2,
  check_B_3,
  check_B_4,
  check_B_5,
  check_A_1,
  check_A_2,
  check_A_3,
  check_A_4,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errString(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    const s = JSON.stringify(err);
    if (s !== undefined) return s;
  } catch {
    // fall through
  }
  return Object.prototype.toString.call(err);
}

/**
 * Type re-exported so callers wiring bespoke fixtures can construct the same
 * request shape the runner uses.
 */
export type { AIResponseContract } from "@appbana/adapter-ai-contract";
