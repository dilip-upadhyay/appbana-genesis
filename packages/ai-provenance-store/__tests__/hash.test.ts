import { strict as assert } from "node:assert";
import { test } from "node:test";

import { canonicalizeRecord, recordId } from "../dist/index.js";

import { makeRecord } from "./fixtures.ts";

test("recordId is deterministic for identical records", () => {
  const a = recordId(makeRecord());
  const b = recordId(makeRecord());
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
});

test("recordId is independent of key ordering", () => {
  // Build the same logical record in a different insertion order.
  const scrambled = makeRecord({
    requestingAgent: "agent.ba-agent",
    modelName: "llama-3.3-70b-instruct",
  });
  const original = makeRecord();
  assert.equal(recordId(scrambled), recordId(original));
});

test("recordId differs when any semantic field differs", () => {
  const a = recordId(makeRecord());
  const b = recordId(makeRecord({ tokenUsage: { input: 1, output: 1, total: 2 } }));
  assert.notEqual(a, b);
});

test("canonicalizeRecord drops undefined fields", () => {
  const r = makeRecord();
  const canonical = canonicalizeRecord(r);
  assert.ok(!canonical.includes("undefined"));
  assert.doesNotThrow(() => JSON.parse(canonical));
});

test("recordId ignores presence-vs-undefined of optional fields", () => {
  const withoutOpt = makeRecord();
  // Deliberately construct via `as` to bypass exactOptionalPropertyTypes —
  // canonicalizeRecord MUST treat explicit `undefined` identically to omitted.
  const withUndefinedOpt = {
    ...makeRecord(),
    modelProviderRegion: undefined,
    humanReview: undefined,
  } as unknown as typeof withoutOpt;
  assert.equal(recordId(withoutOpt), recordId(withUndefinedOpt));
});
