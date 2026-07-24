/**
 * @appbana/ai-adapter-conformance-suite
 *
 * Barrel export. Downstream packages MUST import from this entry point only.
 *
 * @see docs/adr/ADR-015-ai-model-adapter-layer.md
 * @see docs/schemas/ai-adapter-manifest.v0.1.schema.json
 */

export {
  AI_ADAPTER_CONFORMANCE_SUITE_VERSION,
} from "./report.js";
export type {
  ConformanceCheckId,
  ConformanceCheckResult,
  ConformanceReport,
  ConformanceReportSummary,
} from "./report.js";

export { runConformance } from "./runner.js";
export type { ConformanceRunOptions } from "./runner.js";

export {
  conformanceChecks,
  tierIncludes,
} from "./checks.js";
export type {
  Check,
  CheckContext,
  CheckOutcome,
  ConformanceFixtures,
} from "./checks.js";

export {
  DEFAULT_CORRELATION_IDS,
  DEFAULT_FIXTURE_NOW,
  NOOP_LOGGER,
  defaultResponseContract,
  makeInitContext,
  makeInvocationContext,
  makeRequest,
  pickUnsupportedContract,
} from "./fixtures.js";

export { SHA256_HEX_PATTERN, isSha256Hex } from "./hashing.js";
