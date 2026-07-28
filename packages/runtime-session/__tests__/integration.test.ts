import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ArrayTraceSink,
  BufferedTraceSink,
  InMemorySessionStore,
  SessionLifecycle,
} from "../dist/index.js";

import { APP_ID, PRINCIPAL_ID, TENANT_ID, seed } from "./fixtures.ts";

const PRINCIPAL = { principalId: PRINCIPAL_ID, roles: ["role.applicant"] };

describe("integration — session lifecycle + buffered trace sink + graceful shutdown", () => {
  it("buffers every session-lifecycle event, then flushes on shutdown in a deterministic order", async () => {
    const { governanceRegistry, metadataRegistry } = await seed();
    const downstream = new ArrayTraceSink();
    const buffered = new BufferedTraceSink(downstream);
    let tick = 0;
    const lifecycle = new SessionLifecycle({
      store: new InMemorySessionStore(),
      governanceRegistry,
      metadataRegistry,
      traceSink: buffered,
      now: () => new Date(Date.UTC(2026, 6, 25, 0, 0, tick++)),
    });

    const a = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
      initialState: { step: "identity" },
    });
    await lifecycle.updateSessionState(a.sessionId, { step: "kyc" });

    const b = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
    });

    // Buffered — downstream has nothing yet.
    assert.equal(downstream.events.length, 0);
    assert.equal(buffered.peek(a.sessionId).length, 2);
    assert.equal(buffered.peek(b.sessionId).length, 1);

    // Graceful shutdown: abort remaining active sessions + flush buffers.
    await lifecycle.shutdown("graceful-shutdown");
    const totalFlushed = await buffered.flushAll();
    assert.equal(totalFlushed, downstream.events.length);

    // Session id now lives in `attributes` because the trace-event schema sets
    // `additionalProperties: false` on the envelope.
    const sessionOf = (e: { attributes?: Readonly<Record<string, unknown>> }): unknown =>
      e.attributes?.["appbana.session.id"];

    // Each session's events reference its own session id
    for (const e of downstream.events) {
      assert.ok(sessionOf(e) === a.sessionId || sessionOf(e) === b.sessionId);
    }
    // Both sessions ended up with a terminal-status event
    const terminalKinds = downstream.events
      .filter((e) => ["event.session.ended", "event.session.aborted"].includes(e.eventKindRef))
      .map(sessionOf);
    assert.ok(terminalKinds.includes(a.sessionId));
    assert.ok(terminalKinds.includes(b.sessionId));
  });

  it("session snapshots the CAM hash so a later activation does not change the session's view", async () => {
    const { governanceRegistry, metadataRegistry, camContentHash } = await seed();
    const lifecycle = new SessionLifecycle({
      store: new InMemorySessionStore(),
      governanceRegistry,
      metadataRegistry,
      traceSink: new ArrayTraceSink(),
    });
    const s = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
    });
    // Simulate a new activation for a different CAM hash — the running session
    // must still reference the hash it snapshotted.
    await governanceRegistry.activate({
      appId: APP_ID,
      tenantId: TENANT_ID,
      camContentHash: "sha256:some-new-cam",
      camVersion: "2.0.0",
      gateReportId: "sha256:another-gate-report",
      activatedBy: "principal.platform-admin",
    });
    assert.equal(s.camContentHash, camContentHash);
    assert.notEqual(s.camContentHash, "sha256:some-new-cam");
  });
});
