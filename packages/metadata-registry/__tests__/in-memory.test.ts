import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  InMemoryMetadataRegistry,
  computeContentHash,
} from "../dist/index.js";

import { AIM_FIXTURE, BIM_FIXTURE, CAM_FIXTURE } from "./fixtures.ts";

function newRegistry(now = "2026-07-25T12:00:00.000Z"): InMemoryMetadataRegistry {
  return new InMemoryMetadataRegistry({ now: () => new Date(now) });
}

describe("InMemoryMetadataRegistry", () => {
  it("record → get returns the stored artifact", async () => {
    const reg = newRegistry();
    const stored = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    assert.equal(stored.id, computeContentHash(BIM_FIXTURE));
    const fetched = await reg.get(stored.id);
    assert.deepEqual(fetched, stored);
  });

  it("record is idempotent by content hash — second insert returns first row", async () => {
    const reg = newRegistry("2026-07-25T00:00:00.000Z");
    const a = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    // second attempt at same bytes — even with different metadata — returns the first
    const b = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    assert.equal(b.id, a.id);
    assert.equal(b.insertedAt, a.insertedAt);
    assert.equal(await reg.count(), 1);
  });

  it("get returns undefined for unknown id", async () => {
    const reg = newRegistry();
    assert.equal(await reg.get("sha256:deadbeef"), undefined);
  });

  it("find filters by (appId, artifactKind, version)", async () => {
    const reg = newRegistry();
    await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "aim",
      version: "1.0.0",
      content: AIM_FIXTURE,
    });
    await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "cam",
      version: "1.0.0",
      content: CAM_FIXTURE,
    });
    const aims = await reg.find({
      appId: "app.customer-onboarding",
      artifactKind: "aim",
      version: "1.0.0",
    });
    assert.equal(aims.length, 1);
    assert.equal(aims[0]?.artifactKind, "aim");
  });

  it("find filters by tenantId", async () => {
    const reg = newRegistry();
    await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.alpha",
      artifactKind: "bim",
      version: "1.0.0",
      content: BIM_FIXTURE,
    });
    await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.beta",
      artifactKind: "aim",
      version: "1.0.0",
      content: AIM_FIXTURE,
    });
    const alpha = await reg.find({ tenantId: "tenant.alpha" });
    assert.equal(alpha.length, 1);
    assert.equal(alpha[0]?.artifactKind, "bim");
  });

  it("find honours limit", async () => {
    const reg = newRegistry();
    for (let i = 0; i < 5; i += 1) {
      await reg.record({
        appId: "app.customer-onboarding",
        tenantId: "tenant.demo",
        artifactKind: "bim",
        version: `1.0.${String(i)}`,
        content: { ...BIM_FIXTURE, seq: i },
      });
    }
    const two = await reg.find({ limit: 2 });
    assert.equal(two.length, 2);
    assert.equal(await reg.count({ limit: 2 }), 2);
    assert.equal(await reg.count(), 5);
  });

  it("returned entries sort by (insertedAt ASC, id ASC)", async () => {
    let ticks = 0;
    const reg = new InMemoryMetadataRegistry({
      now: () => new Date(Date.UTC(2026, 6, 25, 0, 0, ticks++)),
    });
    const first = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: { seq: 1 },
    });
    const second = await reg.record({
      appId: "app.customer-onboarding",
      tenantId: "tenant.demo",
      artifactKind: "bim",
      version: "1.0.0",
      content: { seq: 2 },
    });
    const all = await reg.find();
    assert.equal(all[0]?.id, first.id);
    assert.equal(all[1]?.id, second.id);
  });
});
