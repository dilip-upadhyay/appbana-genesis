import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  canonicalizeJson,
  canonicalizeJsonString,
  computeContentHash,
  sha256Hex,
} from "../dist/index.js";

describe("hash", () => {
  it("computeContentHash returns sha256:<64-hex>", () => {
    const id = computeContentHash({ a: 1 });
    assert.match(id, /^sha256:[0-9a-f]{64}$/);
  });

  it("canonicalises key order — different insertion order produces the same id", () => {
    const idA = computeContentHash({ a: 1, b: 2, c: 3 });
    const idB = computeContentHash({ c: 3, a: 1, b: 2 });
    assert.equal(idA, idB);
  });

  it("drops undefined-valued keys before hashing", () => {
    const idA = computeContentHash({ a: 1 });
    const idB = computeContentHash({ a: 1, b: undefined });
    assert.equal(idA, idB);
  });

  it("preserves array element order (arrays are semantically ordered)", () => {
    const idA = computeContentHash({ xs: [1, 2, 3] });
    const idB = computeContentHash({ xs: [3, 2, 1] });
    assert.notEqual(idA, idB);
  });

  it("canonicalizeJsonString is stable regardless of key insertion order", () => {
    assert.equal(
      canonicalizeJsonString({ b: 2, a: 1 }),
      canonicalizeJsonString({ a: 1, b: 2 }),
    );
  });

  it("canonicalizeJson recurses into nested objects", () => {
    const out = canonicalizeJson({ z: { b: 1, a: 2 }, a: 1 }) as Record<string, unknown>;
    assert.deepEqual(Object.keys(out), ["a", "z"]);
    assert.deepEqual(Object.keys(out["z"] as object), ["a", "b"]);
  });

  it("sha256Hex is deterministic + matches known vector", () => {
    // sha256("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
