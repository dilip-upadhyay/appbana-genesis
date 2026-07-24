/**
 * Runner — orchestrates init → happy-path invoke → checks → shutdown → report.
 *
 * See ADR-015 § *Conformance Suite* for the intended usage in CI (every AI
 * adapter package MUST run `runConformance` in its own test suite and check-in
 * the emitted `ConformanceReport` as `conformanceEvidence[]` in its manifest).
 */

import type {
  AIAdapterConfig,
  AIAdapterInitContext,
  AIConformanceTier,
  AIInvocationContext,
  AIInvocationRequest,
  AIInvocationResult,
  AIModelAdapter,
} from "@appbana/adapter-ai-contract";

import type { CheckContext, ConformanceFixtures } from "./checks.js";
import { conformanceChecks, tierIncludes } from "./checks.js";
import type {
  ConformanceCheckResult,
  ConformanceReport,
} from "./report.js";
import { AI_ADAPTER_CONFORMANCE_SUITE_VERSION } from "./report.js";
import {
  DEFAULT_CORRELATION_IDS,
  DEFAULT_FIXTURE_NOW,
  defaultResponseContract,
  makeInitContext,
  makeInvocationContext,
  makeRequest,
  pickUnsupportedContract,
} from "./fixtures.js";

/**
 * Optional caller overrides. When omitted, the runner constructs sensible
 * defaults from the adapter's declared capabilities.
 */
export interface ConformanceRunOptions {
  /** Tier to run. Includes all lower tiers by definition. */
  readonly tier: AIConformanceTier;
  /** Adapter-specific configuration; passed verbatim to `adapter.init()`. */
  readonly config: AIAdapterConfig;
  /** Overrides for the init context supplied to the adapter. */
  readonly initContext?: Partial<AIAdapterInitContext>;
  /** Overrides for the invocation context supplied to every check. */
  readonly invocationContext?: Partial<AIInvocationContext>;
  /** Deterministic clock. Defaults to a fixed 2026-07-24 timestamp. */
  readonly now?: () => Date;
  /**
   * Per-check fixture overrides. Anything omitted is built by the runner from
   * the adapter's capabilities.
   */
  readonly fixtures?: Partial<ConformanceFixtures>;
}

export async function runConformance(
  adapter: AIModelAdapter,
  options: ConformanceRunOptions,
): Promise<ConformanceReport> {
  const now = options.now ?? (() => DEFAULT_FIXTURE_NOW);
  const initCtx = buildInitContext(options);

  await adapter.init(options.config, initCtx);

  try {
    const fixtures = buildFixtures(adapter, options, now);

    const {
      happyPathResult,
      happyPathError,
    } = await runHappyPath(adapter, fixtures);

    const checkCtx: CheckContext = {
      adapter,
      capabilities: adapter.capabilities,
      fixtures,
      happyPathResult,
      happyPathError,
    };

    const results: ConformanceCheckResult[] = [];
    for (const check of conformanceChecks) {
      if (!tierIncludes(options.tier, check.tier)) continue;
      const outcome = await runCheckSafely(check, checkCtx);
      results.push({
        id: check.id,
        title: check.title,
        tier: check.tier,
        ...outcomeToResult(outcome),
      });
    }

    return buildReport(adapter, options.tier, results, now);
  } finally {
    await adapter.shutdown();
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildInitContext(options: ConformanceRunOptions): AIAdapterInitContext {
  const overrides = options.initContext ?? {};
  return makeInitContext({
    ...(overrides.deploymentMode !== undefined
      ? { deploymentMode: overrides.deploymentMode }
      : {}),
    ...(overrides.platformKernelVersion !== undefined
      ? { platformKernelVersion: overrides.platformKernelVersion }
      : {}),
    ...(overrides.logger !== undefined ? { logger: overrides.logger } : {}),
  });
}

function buildFixtures(
  adapter: AIModelAdapter,
  options: ConformanceRunOptions,
  now: () => Date,
): ConformanceFixtures {
  const supported = adapter.capabilities.supportedResponseContracts;
  const defaultContract = defaultResponseContract(supported);

  const invocationCtx = makeInvocationContext({
    now,
    ...(options.invocationContext?.environment !== undefined
      ? { environment: options.invocationContext.environment }
      : {}),
    ...(options.invocationContext?.region !== undefined
      ? { region: options.invocationContext.region }
      : {}),
  });

  const overrides = options.fixtures ?? {};

  const happyPathRequest: AIInvocationRequest =
    overrides.happyPathRequest ??
    makeRequest({
      correlationId: DEFAULT_CORRELATION_IDS.happyPath,
      responseContract: defaultContract,
    });

  const abortRequest: AIInvocationRequest =
    overrides.abortRequest ??
    makeRequest({
      correlationId: DEFAULT_CORRELATION_IDS.abort,
      responseContract: defaultContract,
    });

  const budgetBreachRequest: AIInvocationRequest | undefined =
    overrides.budgetBreachRequest ??
    (adapter.capabilities.costPerInputToken !== undefined
      ? makeRequest({
          correlationId: DEFAULT_CORRELATION_IDS.budget,
          responseContract: defaultContract,
          budget: { maxCostUsd: 1e-9 },
        })
      : undefined);

  const unsupportedContract = pickUnsupportedContract(supported);
  const unsupportedContractRequest: AIInvocationRequest | undefined =
    overrides.unsupportedContractRequest ??
    (unsupportedContract !== undefined
      ? makeRequest({
          correlationId: DEFAULT_CORRELATION_IDS.unsupportedContract,
          responseContract: unsupportedContract,
        })
      : undefined);

  const deterministicSeededRequests: readonly [
    AIInvocationRequest,
    AIInvocationRequest,
  ] | undefined =
    overrides.deterministicSeededRequests ??
    (adapter.capabilities.supportsDeterminismHint
      ? [
          makeRequest({
            correlationId: DEFAULT_CORRELATION_IDS.determinismA,
            responseContract: defaultContract,
            seed: 42,
          }),
          makeRequest({
            correlationId: DEFAULT_CORRELATION_IDS.determinismB,
            responseContract: defaultContract,
            seed: 42,
          }),
        ]
      : undefined);

  const fixtures: ConformanceFixtures = {
    invocationContext: invocationCtx,
    happyPathRequest,
    abortRequest,
    ...(budgetBreachRequest !== undefined ? { budgetBreachRequest } : {}),
    ...(unsupportedContractRequest !== undefined
      ? { unsupportedContractRequest }
      : {}),
    ...(deterministicSeededRequests !== undefined
      ? { deterministicSeededRequests }
      : {}),
    ...(overrides.redactionRequest !== undefined
      ? { redactionRequest: overrides.redactionRequest }
      : {}),
    ...(overrides.expectedRedactionPaths !== undefined
      ? { expectedRedactionPaths: overrides.expectedRedactionPaths }
      : {}),
  };
  return fixtures;
}

async function runHappyPath(
  adapter: AIModelAdapter,
  fixtures: ConformanceFixtures,
): Promise<{
  readonly happyPathResult: AIInvocationResult | undefined;
  readonly happyPathError: unknown;
}> {
  try {
    const result = await adapter.invoke(
      fixtures.happyPathRequest,
      fixtures.invocationContext,
    );
    return { happyPathResult: result, happyPathError: undefined };
  } catch (err) {
    return { happyPathResult: undefined, happyPathError: err };
  }
}

async function runCheckSafely(
  check: (typeof conformanceChecks)[number],
  ctx: CheckContext,
): Promise<
  Awaited<ReturnType<(typeof conformanceChecks)[number]["run"]>>
> {
  try {
    return await check.run(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { passed: false, reason: `check threw unexpectedly: ${message}` };
  }
}

function outcomeToResult(
  outcome: Awaited<ReturnType<(typeof conformanceChecks)[number]["run"]>>,
): Omit<ConformanceCheckResult, "id" | "title" | "tier"> {
  if ("skipped" in outcome) {
    return {
      passed: true,
      skipped: true,
      reason: outcome.reason,
      diagnostics: [],
    };
  }
  const base: Omit<ConformanceCheckResult, "id" | "title" | "tier"> = {
    passed: outcome.passed,
    diagnostics: outcome.diagnostics ?? [],
    ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
  };
  return base;
}

function buildReport(
  adapter: AIModelAdapter,
  tier: AIConformanceTier,
  checks: readonly ConformanceCheckResult[],
  now: () => Date,
): ConformanceReport {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const c of checks) {
    if (c.skipped === true) skipped += 1;
    else if (c.passed) passed += 1;
    else failed += 1;
  }
  return {
    conformanceSuiteVersion: AI_ADAPTER_CONFORMANCE_SUITE_VERSION,
    adapterBinding: adapter.binding,
    adapterVersion: adapter.capabilities.adapterVersion,
    tier,
    executedAt: now().toISOString(),
    summary: { passed, failed, skipped },
    checks,
    passed: failed === 0,
  };
}
