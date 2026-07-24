import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { AIInvocationResult } from "@appbana/adapter-ai-contract";

import {
  InMemoryAIProvenanceStore,
  MissingProvenanceError,
  assertProvenance,
  recordId,
} from "../dist/index.js";

import { makeRecord } from "./fixtures.ts";

function makeResult(
  overrides: Partial<AIInvocationResult> = {},
): AIInvocationResult {
  const provenance = makeRecord();
  return {
    outcome: "accepted",
    invocationId: "inv-1",
    text: "hello",
    diagnostics: [],
    provenance,
    ...overrides,
  } as AIInvocationResult;
}

test("assertProvenance passes for a well-formed result", () => {
  assert.doesNotThrow(() => assertProvenance(makeResult()));
});

test("assertProvenance throws PROVENANCE_MISSING when provenance is absent", () => {
  const result = { outcome: "accepted", diagnostics: [] } as unknown as AIInvocationResult;
  assert.throws(
    () => assertProvenance(result),
    (err: unknown) => {
      assert.ok(err instanceof MissingProvenanceError);
      assert.equal(err.code, "PROVENANCE_MISSING");
      return true;
    },
  );
});

test("assertProvenance throws PROVENANCE_FIELD_MISSING for empty inputHash", () => {
  const result = makeResult({
    provenance: makeRecord({ inputHash: "" }),
  });
  assert.throws(
    () => assertProvenance(result),
    (err: unknown) => {
      assert.ok(err instanceof MissingProvenanceError);
      assert.equal(err.code, "PROVENANCE_FIELD_MISSING");
      assert.equal(err.missingField, "inputHash");
      return true;
    },
  );
});

test("assertProvenance throws for negative wallClockMs", () => {
  const result = makeResult({ provenance: makeRecord({ wallClockMs: -1 }) });
  assert.throws(
    () => assertProvenance(result),
    (err: unknown) => {
      assert.ok(err instanceof MissingProvenanceError);
      assert.equal(err.missingField, "wallClockMs");
      return true;
    },
  );
});

test("assertProvenance throws when redactions is not an array", () => {
  const result = makeResult({
    provenance: makeRecord({
      // deliberately-broken shape via cast
      redactions: undefined as unknown as [],
    }),
  });
  assert.throws(
    () => assertProvenance(result),
    (err: unknown) => {
      assert.ok(err instanceof MissingProvenanceError);
      assert.equal(err.missingField, "redactions");
      return true;
    },
  );
});

test("assertProvenance with stored succeeds when store id matches recomputed hash", async () => {
  const store = new InMemoryAIProvenanceStore();
  const result = makeResult();
  const stored = await store.record(result.provenance!);
  assert.equal(stored.id, recordId(result.provenance!));
  assert.doesNotThrow(() => assertProvenance(result, stored));
});

test("assertProvenance with stored throws PROVENANCE_ID_MISMATCH when store lies", () => {
  const result = makeResult();
  const stored = {
    id: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    insertedAt: "2026-07-24T12:00:00.000Z",
    record: result.provenance!,
  };
  assert.throws(
    () => assertProvenance(result, stored),
    (err: unknown) => {
      assert.ok(err instanceof MissingProvenanceError);
      assert.equal(err.code, "PROVENANCE_ID_MISMATCH");
      return true;
    },
  );
});
