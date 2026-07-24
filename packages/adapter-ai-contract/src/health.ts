/**
 * Adapter health probe result.
 *
 * Consumed by the platform readiness endpoint (`/readyz` per ADR-016). Adapters
 * MUST return within a few hundred milliseconds; expensive probes belong in a
 * separate background job.
 */

export type AIAdapterHealthState = "healthy" | "degraded" | "unhealthy";

export interface AIAdapterHealth {
  readonly state: AIAdapterHealthState;
  /** Human-readable summary. Displayed in operator dashboards. MUST NOT contain PII. */
  readonly summary: string;
  /** ISO-8601 UTC timestamp of the probe. */
  readonly checkedAt: string;
  /** Optional structured details, e.g. `{queueDepth: 12, lastErrorCode: "RATE_LIMITED"}`. */
  readonly details?: Readonly<Record<string, unknown>>;
}
