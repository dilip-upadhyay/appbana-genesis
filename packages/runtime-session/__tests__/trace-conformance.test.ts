import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ArrayTraceSink,
  BufferedTraceSink,
  InMemorySessionStore,
  SessionLifecycle,
} from "../dist/index.js";
import { APP_ID, PRINCIPAL_ID, TENANT_ID, seed } from "./fixtures.ts";

// Ajv ships CJS with an interop `default`; match the pattern already used in
// @appbana/canonical-application-generator.
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

/**
 * Conformance of emitted trace events against the *actual* published schema.
 *
 * Until this file existed, no test in the repository loaded
 * `docs/schemas/trace-event.v0.1.schema.json`. The emitted event shape had
 * drifted so far from it that it violated 8 of the 10 required properties and
 * carried 8 keys the schema rejects under `additionalProperties: false`. Most
 * consequentially it had no `traceContext`, which makes the day-one
 * OpenTelemetry propagation requirement structurally impossible.
 *
 * A structural TypeScript interface cannot catch that drift. Only validating
 * against the shipped schema can, so that is what this does.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(here, "../../../docs/schemas/trace-event.v0.1.schema.json");

function buildValidator(): (event: unknown) => { ok: boolean; errors: string } {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return (event: unknown) => {
    const ok = validate(event);
    const errors = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim())
      .join("; ");
    return { ok, errors };
  };
}

/** Deterministic generators so failures name a specific event, not a random uuid. */
function deterministicDeps(): {
  eventIdGenerator: () => string;
  correlationIdGenerator: () => string;
  traceIdGenerator: () => string;
  spanIdGenerator: () => string;
} {
  let events = 0;
  let spans = 0;
  const pad = (n: number, width: number): string => n.toString(16).padStart(width, "0");
  return {
    eventIdGenerator: () => {
      events += 1;
      return `00000000-0000-4000-8000-${pad(events, 12)}`;
    },
    correlationIdGenerator: () => "11111111-1111-4111-8111-111111111111",
    traceIdGenerator: () => "a".repeat(32),
    spanIdGenerator: () => {
      spans += 1;
      return pad(spans, 16);
    },
  };
}

async function collectEvents(): Promise<readonly unknown[]> {
  const { metadataRegistry, governanceRegistry } = await seed();
  const downstream = new ArrayTraceSink();
  const buffered = new BufferedTraceSink(downstream);

  const lifecycle = new SessionLifecycle({
    store: new InMemorySessionStore(),
    governanceRegistry,
    metadataRegistry,
    traceSink: buffered,
    now: () => new Date("2026-07-28T10:00:00.000Z"),
    environment: "dev",
    kernelVersion: "0.1.0",
    ...deterministicDeps(),
  });

  // Exercise every emitted event kind.
  const session = await lifecycle.startSession({
    appId: APP_ID,
    tenantId: TENANT_ID,
    principal: { principalId: PRINCIPAL_ID, roles: ["role.applicant"] },
  });
  await lifecycle.updateSessionState(session.sessionId, { legalName: "Acme Ltd" });
  await lifecycle.endSession(session.sessionId, "completed");

  const aborted = await lifecycle.startSession({
    appId: APP_ID,
    tenantId: TENANT_ID,
    principal: { principalId: PRINCIPAL_ID, roles: ["role.reviewer"] },
  });
  await lifecycle.abortSession(aborted.sessionId, "operator shutdown");

  await buffered.flushAll();
  return downstream.events;
}

test("every emitted trace event validates against trace-event.v0.1.schema.json", async () => {
  const validate = buildValidator();
  const events = await collectEvents();

  assert.ok(events.length > 0, "no trace events were emitted");

  for (const event of events) {
    const kind = (event as { eventKindRef?: string }).eventKindRef ?? "<unknown>";
    const { ok, errors } = validate(event);
    assert.ok(ok, `${kind} failed trace-event schema validation: ${errors}`);
  }
});

test("all four session event kinds are emitted and each one conforms", async () => {
  const validate = buildValidator();
  const events = (await collectEvents()) as { eventKindRef: string }[];

  const kinds = [...new Set(events.map((e) => e.eventKindRef))].sort((a, b) =>
    a.localeCompare(b),
  );
  assert.deepEqual(kinds, [
    "event.session.aborted",
    "event.session.ended",
    "event.session.started",
    "event.session.state.updated",
  ]);

  for (const kind of kinds) {
    const sample = events.find((e) => e.eventKindRef === kind);
    assert.ok(validate(sample).ok, `${kind} does not conform`);
  }
});

test("trace context is present and W3C-shaped on every event", async () => {
  const events = (await collectEvents()) as {
    traceContext: { traceId: string; spanId: string };
  }[];

  for (const event of events) {
    assert.match(event.traceContext.traceId, /^[0-9a-f]{32}$/);
    assert.match(event.traceContext.spanId, /^[0-9a-f]{16}$/);
  }

  // Every event within a single session must share that session's trace id, or
  // the Trace Viewer cannot reconstruct the session as one trace.
  const traceIds = new Set(events.map((e) => e.traceContext.traceId));
  assert.equal(traceIds.size, 1, "all events in this scenario belong to one injected trace id");

  // Span ids must be unique per event.
  const spanIds = events.map((e) => e.traceContext.spanId);
  assert.equal(spanIds.length, new Set(spanIds).size, "span ids must be unique per event");
});

test("redactions is always present, so 'none redacted' is distinguishable from 'not run'", async () => {
  const events = (await collectEvents()) as { redactions?: unknown }[];
  for (const event of events) {
    assert.ok(Array.isArray(event.redactions), "redactions must be an array, even when empty");
  }
});

test("state-update payloads carry only key names, never values", async () => {
  const events = (await collectEvents()) as {
    eventKindRef: string;
    payload: Record<string, unknown>;
  }[];

  const update = events.find((e) => e.eventKindRef === "event.session.state.updated");
  assert.ok(update, "expected a state-update event");
  assert.deepEqual(update.payload, { patchKeys: ["legalName"] });
  assert.ok(
    !JSON.stringify(update.payload).includes("Acme Ltd"),
    "session state values must never reach the trace wire",
  );
});

test("a malformed event is actually rejected — the validator is not vacuous", () => {
  const validate = buildValidator();

  // Guards against the test above passing because validation silently no-ops.
  const missingTraceContext = {
    traceEventVersion: "0.1",
    id: "00000000-0000-4000-8000-000000000001",
    eventKindRef: "event.session.started",
    occurredAt: "2026-07-28T10:00:00.000Z",
    producedBy: { kind: "kernel", subsystem: "session" },
    correlation: { correlationId: "11111111-1111-4111-8111-111111111111" },
    context: {
      appId: APP_ID,
      camId: "cam.customer-onboarding",
      camVersion: "1.0.0",
      environment: "dev",
    },
    severity: "info",
    payload: {},
    redactions: [],
  };
  assert.equal(validate(missingTraceContext).ok, false, "missing traceContext must fail");

  const legacyShape = {
    traceEventVersion: "0.1",
    eventId: "evt-1",
    eventKindId: "event.session.started",
    emittedAt: "2026-07-28T10:00:00.000Z",
    producedBy: { runtimeRole: "kernel", component: "runtime-session" },
    payload: {},
  };
  assert.equal(validate(legacyShape).ok, false, "the pre-fix event shape must fail");
});
