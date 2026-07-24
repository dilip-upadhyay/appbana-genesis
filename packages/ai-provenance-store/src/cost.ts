/**
 * Cost aggregation utilities.
 *
 * Adapters enforce a per-call budget pre-check (worst-case cost <= maxCostUsd)
 * inside `AIInvocationRequest.budget`. That prevents one runaway call from
 * escaping. This module answers the orthogonal question: **"have we blown the
 * budget across the day / tenant / model?"** — the aggregate view the CAM
 * Generator and finance reports care about.
 *
 * Cost is computed from `provenance.tokenUsage` × capabilities.costPer*Token.
 * Because provenance is append-only and content-addressed, the sum is
 * reproducible: replaying `aggregateCostByTenantAndDay` at any later time
 * yields the same output for the same records.
 *
 * Local models (`ai:local-*`) have no cost fields — their aggregate estimated
 * cost is 0.
 */

import type { AIProvenanceStore, ProvenanceQuery, StoredEntry } from "./types.js";

/**
 * Per-binding cost coefficients. Matches the fields adapters expose on
 * `AIAdapterCapabilities` (`costPerInputToken`, `costPerOutputToken`).
 */
export interface CostCoefficients {
  readonly costPerInputToken: number;
  readonly costPerOutputToken: number;
}

/** Map keyed by `modelBinding` (e.g. `"ai:anthropic-claude"`). */
export type CostCatalog = ReadonlyMap<string, CostCoefficients>;

/**
 * Options for `aggregateCostByTenantAndDay`. All filters are optional; when
 * omitted, the aggregate covers every record the store returns.
 */
export interface CostAggregationOptions {
  /**
   * Include only entries with `record.completedAt >= since` (ISO-8601).
   * Filter is applied client-side against the AI record's completion time —
   * not against the store's `insertedAt`, which can drift for backfilled rows.
   */
  readonly since?: string;
  /** Include only entries with `record.completedAt <= until` (ISO-8601). */
  readonly until?: string;
  /** Limit to a single tenant. */
  readonly tenantId?: string;
  /** Limit to a single model binding. */
  readonly modelBinding?: string;
  /** Cost coefficients per binding. Bindings not present here contribute $0. */
  readonly catalog: CostCatalog;
}

/** One row of the aggregate — a (tenant, binding, UTC day) tuple. */
export interface CostSummary {
  readonly tenantId: string;
  readonly modelBinding: string;
  /** `YYYY-MM-DD` in UTC. */
  readonly day: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Sum of per-record `input×costPerInput + output×costPerOutput`. */
  readonly estimatedUsd: number;
}

/**
 * Return per-(tenant, binding, day) cost aggregates ordered by
 * `(tenantId, day, modelBinding)`. Records outside the `since`/`until` window
 * or belonging to filtered-out tenants/bindings are ignored.
 */
export async function aggregateCostByTenantAndDay(
  store: AIProvenanceStore,
  options: CostAggregationOptions,
): Promise<readonly CostSummary[]> {
  const filter: ProvenanceQuery = {
    ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
    ...(options.modelBinding !== undefined ? { modelBinding: options.modelBinding } : {}),
  };
  const entries = (await store.query(filter)).filter((e) =>
    withinCompletionWindow(e.record.completedAt, options.since, options.until),
  );

  const buckets = new Map<string, MutableSummary>();
  for (const entry of entries) {
    const key = bucketKey(entry);
    const bucket = buckets.get(key) ?? emptyBucket(entry);
    bucket.calls += 1;
    bucket.inputTokens += entry.record.tokenUsage.input;
    bucket.outputTokens += entry.record.tokenUsage.output;
    bucket.totalTokens += entry.record.tokenUsage.total;
    const coeff = options.catalog.get(entry.record.modelBinding);
    if (coeff !== undefined) {
      bucket.estimatedUsd +=
        entry.record.tokenUsage.input * coeff.costPerInputToken +
        entry.record.tokenUsage.output * coeff.costPerOutputToken;
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map(freeze)
    .sort(compareSummaries);
}

/** Result of a per-tenant, per-day budget check. */
export interface BudgetStatus {
  readonly tenantId: string;
  readonly day: string;
  readonly budgetUsd: number;
  readonly spentUsd: number;
  readonly remainingUsd: number;
  readonly exceeded: boolean;
}

/**
 * Cheap end-of-day check: sum spend for `tenantId` on `day` and compare to
 * `budgetUsd`. `day` is `YYYY-MM-DD` interpreted as UTC.
 */
export async function getBudgetRemaining(
  store: AIProvenanceStore,
  budgetUsd: number,
  tenantId: string,
  day: string,
  catalog: CostCatalog,
): Promise<BudgetStatus> {
  const since = `${day}T00:00:00.000Z`;
  const until = `${day}T23:59:59.999Z`;
  const summaries = await aggregateCostByTenantAndDay(store, {
    since,
    until,
    tenantId,
    catalog,
  });
  const spentUsd = summaries.reduce((acc, s) => acc + s.estimatedUsd, 0);
  const remainingUsd = budgetUsd - spentUsd;
  return {
    tenantId,
    day,
    budgetUsd,
    spentUsd,
    remainingUsd,
    exceeded: spentUsd > budgetUsd,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface MutableSummary {
  tenantId: string;
  modelBinding: string;
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedUsd: number;
}

function bucketKey(entry: StoredEntry): string {
  return `${entry.record.tenantId}\u0000${entry.record.modelBinding}\u0000${utcDay(entry.record.completedAt)}`;
}

function emptyBucket(entry: StoredEntry): MutableSummary {
  return {
    tenantId: entry.record.tenantId,
    modelBinding: entry.record.modelBinding,
    day: utcDay(entry.record.completedAt),
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedUsd: 0,
  };
}

function utcDay(iso: string): string {
  // Provenance timestamps are always ISO-8601 UTC. Take the first 10 chars.
  return iso.slice(0, 10);
}

function withinCompletionWindow(
  completedAt: string,
  since: string | undefined,
  until: string | undefined,
): boolean {
  if (since !== undefined && completedAt < since) return false;
  if (until !== undefined && completedAt > until) return false;
  return true;
}

function freeze(s: MutableSummary): CostSummary {
  return {
    tenantId: s.tenantId,
    modelBinding: s.modelBinding,
    day: s.day,
    calls: s.calls,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    totalTokens: s.totalTokens,
    estimatedUsd: s.estimatedUsd,
  };
}

function compareSummaries(a: CostSummary, b: CostSummary): number {
  const t = a.tenantId.localeCompare(b.tenantId);
  if (t !== 0) return t;
  const d = a.day.localeCompare(b.day);
  if (d !== 0) return d;
  return a.modelBinding.localeCompare(b.modelBinding);
}
