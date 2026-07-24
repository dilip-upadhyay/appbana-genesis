/**
 * Default fixture builders — construct the `AIInvocationRequest` /
 * `AIInvocationContext` / `AIAdapterInitContext` shapes the checks need.
 *
 * Callers may override any of these via `runConformance` options; the runner
 * falls back to these when a specific fixture is not supplied.
 */

import type {
  AIAdapterInitContext,
  AIInvocationContext,
  AIInvocationRequest,
  AIResponseContract,
  AIResponseContractKind,
} from "@appbana/adapter-ai-contract";

/** Deterministic timestamp used by every default fixture. */
export const DEFAULT_FIXTURE_NOW = new Date("2026-07-24T00:00:00.000Z");

/** UUIDs used by the default happy-path / abort / budget / redaction requests. */
export const DEFAULT_CORRELATION_IDS = {
  happyPath: "00000000-0000-4000-8000-000000000001",
  abort: "00000000-0000-4000-8000-000000000002",
  budget: "00000000-0000-4000-8000-000000000003",
  unsupportedContract: "00000000-0000-4000-8000-000000000004",
  determinismA: "00000000-0000-4000-8000-000000000005",
  determinismB: "00000000-0000-4000-8000-000000000006",
  redaction: "00000000-0000-4000-8000-000000000007",
} as const;

/** No-op logger the default init context supplies. */
export const NOOP_LOGGER: AIAdapterInitContext["logger"] = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface MakeInitContextInput {
  readonly deploymentMode?: AIAdapterInitContext["deploymentMode"];
  readonly platformKernelVersion?: string;
  readonly logger?: AIAdapterInitContext["logger"];
}

export function makeInitContext(
  input: MakeInitContextInput = {},
): AIAdapterInitContext {
  return {
    deploymentMode: input.deploymentMode ?? "dedicated-cloud",
    platformKernelVersion: input.platformKernelVersion ?? "0.1.0",
    logger: input.logger ?? NOOP_LOGGER,
  };
}

export interface MakeInvocationContextInput {
  readonly correlationSeed?: string;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  readonly environment?: AIInvocationContext["environment"];
  readonly region?: string;
}

export function makeInvocationContext(
  input: MakeInvocationContextInput = {},
): AIInvocationContext {
  const now = input.now ?? (() => DEFAULT_FIXTURE_NOW);
  const base: AIInvocationContext = {
    tenantId: "tenant.conformance",
    appId: "app.conformance",
    camId: "cam.conformance",
    camVersion: "0.1.0",
    environment: input.environment ?? "dev",
    traceContext: {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
    },
    now,
    ...(input.region !== undefined ? { region: input.region } : {}),
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  };
  return base;
}

export interface MakeRequestInput {
  readonly correlationId: string;
  readonly responseContract: AIResponseContract;
  readonly promptTemplateRef?: string;
  readonly promptTemplateVersion?: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly seed?: number;
  readonly budget?: AIInvocationRequest["budget"];
}

export function makeRequest(input: MakeRequestInput): AIInvocationRequest {
  const base: AIInvocationRequest = {
    promptTemplateRef:
      input.promptTemplateRef ?? "prompt.conformance.smoke",
    promptTemplateVersion: input.promptTemplateVersion ?? "1.0.0",
    inputs: input.inputs ?? { message: "hello" },
    responseContract: input.responseContract,
    budget: input.budget ?? {},
    correlationId: input.correlationId,
    requestingAgent: "agent.conformance",
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  };
  return base;
}

/**
 * Pick a default response contract given an adapter's supported list. Prefers
 * `free-text` (most adapters support it); otherwise, uses the first entry with
 * a minimum schema stub.
 */
export function defaultResponseContract(
  supported: readonly AIResponseContractKind[],
): AIResponseContract {
  if (supported.includes("free-text")) {
    return { kind: "free-text" };
  }
  const first = supported[0];
  if (first === undefined) {
    // Runner's C.3 check catches this earlier; safe fallback.
    return { kind: "free-text" };
  }
  switch (first) {
    case "json-schema":
      return {
        kind: "json-schema",
        schema: { type: "object", additionalProperties: true },
      };
    case "tool-use":
      return { kind: "tool-use", toolCatalogRef: "tool-catalog.conformance:v1" };
    case "embedding-vector":
      return { kind: "embedding-vector", dimensions: 8 };
    case "transcript":
      return { kind: "transcript" };
    case "free-text":
      return { kind: "free-text" };
    default: {
      const _exhaustive: never = first;
      return _exhaustive;
    }
  }
}

/**
 * Pick a response contract the adapter does NOT support. Used by the B.2
 * check. Returns `undefined` when the adapter supports every kind — the check
 * then reports skipped.
 */
export function pickUnsupportedContract(
  supported: readonly AIResponseContractKind[],
): AIResponseContract | undefined {
  const all: readonly AIResponseContractKind[] = [
    "free-text",
    "json-schema",
    "tool-use",
    "embedding-vector",
    "transcript",
  ];
  const missing = all.find((k) => !supported.includes(k));
  if (missing === undefined) return undefined;
  switch (missing) {
    case "free-text":
      return { kind: "free-text" };
    case "json-schema":
      return {
        kind: "json-schema",
        schema: { type: "object", additionalProperties: false },
      };
    case "tool-use":
      return { kind: "tool-use", toolCatalogRef: "tool-catalog.unsupported:v1" };
    case "embedding-vector":
      return { kind: "embedding-vector", dimensions: 4 };
    case "transcript":
      return { kind: "transcript" };
    default: {
      const _exhaustive: never = missing;
      return _exhaustive;
    }
  }
}
