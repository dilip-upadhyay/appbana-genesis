import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  InMemorySessionStore,
  type Session,
} from "../dist/index.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: "session-1",
    appId: "app.a",
    tenantId: "tenant.alpha",
    principal: { principalId: "p.1", roles: ["role.applicant"] },
    camId: "cam.a",
    camContentHash: "sha256:aaa",
    camVersion: "1.0.0",
    status: "active",
    state: {},
    startedAt: "2026-07-25T00:00:00.000Z",
    traceId: "a".repeat(32),
    correlationId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

describe("InMemorySessionStore", () => {
  it("put + get round-trips a session by id", async () => {
    const store = new InMemorySessionStore();
    const s = makeSession();
    await store.put(s);
    assert.deepEqual(await store.get(s.sessionId), s);
  });

  it("get returns undefined for an unknown id", async () => {
    const store = new InMemorySessionStore();
    assert.equal(await store.get("nope"), undefined);
  });

  it("put overwrites when the same id is written twice (upsert semantics)", async () => {
    const store = new InMemorySessionStore();
    await store.put(makeSession({ state: { step: 1 } }));
    await store.put(makeSession({ state: { step: 2 } }));
    const got = await store.get("session-1");
    assert.deepEqual(got?.state, { step: 2 });
  });

  it("list with no filter returns every session", async () => {
    const store = new InMemorySessionStore();
    await store.put(makeSession({ sessionId: "s1" }));
    await store.put(
      makeSession({ sessionId: "s2", startedAt: "2026-07-25T00:00:01.000Z" }),
    );
    const all = await store.list();
    assert.equal(all.length, 2);
  });

  it("list filters by appId, tenantId, principalId, status independently", async () => {
    const store = new InMemorySessionStore();
    await store.put(makeSession({ sessionId: "s1", appId: "app.a" }));
    await store.put(makeSession({ sessionId: "s2", appId: "app.b" }));
    await store.put(
      makeSession({ sessionId: "s3", tenantId: "tenant.beta" }),
    );
    await store.put(
      makeSession({
        sessionId: "s4",
        principal: { principalId: "p.other", roles: [] },
      }),
    );
    await store.put(makeSession({ sessionId: "s5", status: "closed" }));

    assert.equal((await store.list({ appId: "app.b" })).length, 1);
    assert.equal((await store.list({ tenantId: "tenant.beta" })).length, 1);
    assert.equal(
      (await store.list({ principalId: "p.other" })).length,
      1,
    );
    assert.equal((await store.list({ status: "closed" })).length, 1);
    assert.equal((await store.list({ status: "active" })).length, 4);
  });

  it("list is sorted (startedAt ASC, sessionId ASC) for byte-stable output", async () => {
    const store = new InMemorySessionStore();
    await store.put(
      makeSession({ sessionId: "s.b", startedAt: "2026-07-25T00:00:01.000Z" }),
    );
    await store.put(
      makeSession({ sessionId: "s.a", startedAt: "2026-07-25T00:00:00.000Z" }),
    );
    await store.put(
      makeSession({ sessionId: "s.c", startedAt: "2026-07-25T00:00:00.000Z" }),
    );
    const ids = (await store.list()).map((s) => s.sessionId);
    assert.deepEqual(ids, ["s.a", "s.c", "s.b"]);
  });

  it("tenants are isolated by the tenantId filter", async () => {
    const store = new InMemorySessionStore();
    await store.put(makeSession({ sessionId: "s1", tenantId: "t1" }));
    await store.put(makeSession({ sessionId: "s2", tenantId: "t2" }));
    const t1 = await store.list({ tenantId: "t1" });
    assert.equal(t1.length, 1);
    assert.equal(t1[0]?.sessionId, "s1");
  });
});
