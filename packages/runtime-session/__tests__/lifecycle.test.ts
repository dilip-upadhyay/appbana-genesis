import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { InMemoryMetadataRegistry } from "@appbana/metadata-registry";
import { InMemoryGovernanceRegistry } from "@appbana/platform-kernel";

import {
  ArrayTraceSink,
  InMemorySessionStore,
  SessionAlreadyEndedError,
  SessionLifecycle,
  SessionNotFoundError,
  InvalidPrincipalError,
} from "../dist/index.js";

import { APP_ID, CAM_VERSION, PRINCIPAL_ID, TENANT_ID, seed } from "./fixtures.ts";

function deterministicClock(startIso: string): () => Date {
  let tick = 0;
  const base = new Date(startIso).getTime();
  return () => new Date(base + tick++ * 1000);
}

function counterId(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

async function makeLifecycle() {
  const { governanceRegistry, metadataRegistry, camContentHash } = await seed();
  const store = new InMemorySessionStore();
  const sink = new ArrayTraceSink();
  const lifecycle = new SessionLifecycle({
    store,
    governanceRegistry,
    metadataRegistry,
    traceSink: sink,
    now: deterministicClock("2026-07-25T00:00:00.000Z"),
    sessionIdGenerator: counterId("session"),
    eventIdGenerator: counterId("evt"),
  });
  return { lifecycle, store, sink, camContentHash };
}

const PRINCIPAL = {
  principalId: PRINCIPAL_ID,
  roles: ["role.applicant"],
};

describe("SessionLifecycle — startSession", () => {
  it("returns a persisted Session snapshotting the active CAM", async () => {
    const { lifecycle, store, camContentHash } = await makeLifecycle();
    const s = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
    });
    assert.equal(s.sessionId, "session-1");
    assert.equal(s.appId, APP_ID);
    assert.equal(s.tenantId, TENANT_ID);
    assert.equal(s.principal.principalId, PRINCIPAL_ID);
    assert.equal(s.camVersion, CAM_VERSION);
    assert.equal(s.camContentHash, camContentHash);
    assert.equal(s.status, "active");
    assert.deepEqual(s.state, {});
    // persisted
    assert.deepEqual(await store.get(s.sessionId), s);
  });

  it("emits event.session.started into the trace sink referencing the resolved CAM", async () => {
    const { lifecycle, sink, camContentHash } = await makeLifecycle();
    await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
    });
    assert.equal(sink.events.length, 1);
    const e = sink.events[0]!;
    assert.equal(e.eventKindId, "event.session.started");
    assert.equal(e.camContentHash, camContentHash);
    assert.equal(e.camVersion, CAM_VERSION);
    assert.equal(e.producedBy.component, "runtime-session");
    assert.equal(e.producedBy.runtimeRole, "kernel");
    assert.deepEqual(e.payload, {
      principalId: PRINCIPAL_ID,
      roleCount: 1,
    });
  });

  it("propagates resolveCam errors when no pointer is active (fail-closed)", async () => {
    const metadataRegistry = new InMemoryMetadataRegistry();
    const governanceRegistry = new InMemoryGovernanceRegistry();
    const lifecycle = new SessionLifecycle({
      store: new InMemorySessionStore(),
      governanceRegistry,
      metadataRegistry,
      traceSink: new ArrayTraceSink(),
    });
    await assert.rejects(
      lifecycle.startSession({
        appId: APP_ID,
        tenantId: TENANT_ID,
        principal: PRINCIPAL,
      }),
      (e: Error) => (e as { code?: string }).code === "NO_ACTIVE_POINTER",
    );
  });

  it("rejects a principal missing principalId", async () => {
    const { lifecycle } = await makeLifecycle();
    await assert.rejects(
      lifecycle.startSession({
        appId: APP_ID,
        tenantId: TENANT_ID,
        principal: { principalId: "", roles: [] },
      }),
      InvalidPrincipalError,
    );
  });

  it("carries initialState through into the persisted session", async () => {
    const { lifecycle, store } = await makeLifecycle();
    const s = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
      initialState: { step: "identity" },
    });
    const persisted = await store.get(s.sessionId);
    assert.deepEqual(persisted?.state, { step: "identity" });
  });
});

describe("SessionLifecycle — updateSessionState", () => {
  it("merges the patch, persists it, and emits event.session.state.updated with sorted patchKeys", async () => {
    const { lifecycle, sink, store } = await makeLifecycle();
    const started = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
      initialState: { step: "identity" },
    });
    const updated = await lifecycle.updateSessionState(started.sessionId, {
      taxId: "12-3456789",
      step: "kyc",
    });
    assert.deepEqual(updated.state, { step: "kyc", taxId: "12-3456789" });
    assert.deepEqual((await store.get(started.sessionId))?.state, updated.state);
    const stateEvent = sink.events.find(
      (e) => e.eventKindId === "event.session.state.updated",
    );
    assert.ok(stateEvent);
    assert.deepEqual(stateEvent!.payload, {
      patchKeys: ["step", "taxId"],
    });
  });

  it("throws SessionNotFoundError when the session is unknown", async () => {
    const { lifecycle } = await makeLifecycle();
    await assert.rejects(
      lifecycle.updateSessionState("unknown", { x: 1 }),
      SessionNotFoundError,
    );
  });

  it("throws SessionAlreadyEndedError when the session is not active", async () => {
    const { lifecycle } = await makeLifecycle();
    const s = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
    });
    await lifecycle.endSession(s.sessionId);
    await assert.rejects(
      lifecycle.updateSessionState(s.sessionId, { x: 1 }),
      SessionAlreadyEndedError,
    );
  });
});

describe("SessionLifecycle — endSession / abortSession", () => {
  it("endSession marks status closed with durationMs in the event payload", async () => {
    const { lifecycle, sink } = await makeLifecycle();
    const s = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
    });
    const ended = await lifecycle.endSession(s.sessionId, "completed");
    assert.equal(ended.status, "closed");
    assert.equal(ended.endReason, "completed");
    assert.ok(ended.endedAt);
    const evt = sink.events.find((e) => e.eventKindId === "event.session.ended");
    assert.ok(evt);
    assert.equal(evt!.payload["status"], "closed");
    assert.equal(evt!.payload["reason"], "completed");
    assert.equal(typeof evt!.payload["durationMs"], "number");
  });

  it("abortSession marks status aborted and emits event.session.aborted", async () => {
    const { lifecycle, sink } = await makeLifecycle();
    const s = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
    });
    const aborted = await lifecycle.abortSession(s.sessionId, "kernel-shutdown");
    assert.equal(aborted.status, "aborted");
    const evt = sink.events.find(
      (e) => e.eventKindId === "event.session.aborted",
    );
    assert.ok(evt);
    assert.equal(evt!.payload["reason"], "kernel-shutdown");
  });

  it("endSession on an already-ended session throws SessionAlreadyEndedError", async () => {
    const { lifecycle } = await makeLifecycle();
    const s = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
    });
    await lifecycle.endSession(s.sessionId);
    await assert.rejects(
      lifecycle.endSession(s.sessionId),
      SessionAlreadyEndedError,
    );
  });

  it("endSession on an unknown session throws SessionNotFoundError", async () => {
    const { lifecycle } = await makeLifecycle();
    await assert.rejects(
      lifecycle.endSession("unknown"),
      SessionNotFoundError,
    );
  });
});

describe("SessionLifecycle — shutdown", () => {
  it("aborts every still-active session with the given reason and returns the count", async () => {
    const { lifecycle, store } = await makeLifecycle();
    const a = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
    });
    const b = await lifecycle.startSession({
      appId: APP_ID,
      tenantId: TENANT_ID,
      principal: PRINCIPAL,
    });
    // Manually close one — shutdown should not touch it.
    await lifecycle.endSession(a.sessionId, "user-closed");
    const count = await lifecycle.shutdown("graceful-shutdown");
    assert.equal(count, 1);
    const stillActive = await store.list({ status: "active" });
    assert.equal(stillActive.length, 0);
    const afterB = await store.get(b.sessionId);
    assert.equal(afterB?.status, "aborted");
    assert.equal(afterB?.endReason, "graceful-shutdown");
  });
});
