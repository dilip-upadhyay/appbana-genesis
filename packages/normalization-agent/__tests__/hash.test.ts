/**
 * Hash + canonicalization tests.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { canonicalizeJson, contentHash, sha256Hex } from "../dist/index.js";

describe("hash: sha256Hex", () => {
  it("produces the canonical empty-string sha256", () => {
    assert.equal(
      sha256Hex(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("hash: canonicalizeJson", () => {
  it("sorts object keys recursively", () => {
    const a = canonicalizeJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalizeJson({ a: { c: 3, d: 2 }, b: 1 });
    assert.equal(a, b);
    assert.equal(a, '{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    assert.equal(canonicalizeJson([3, 1, 2]), "[3,1,2]");
  });

  it("drops undefined values but keeps null", () => {
    // A raw undefined would be dropped by JSON.stringify anyway; we want the
    // canonicalization step to explicitly filter it too so that Object.entries
    // does not see it.
    const withUndef = { a: undefined, b: null, c: 1 } as Record<string, unknown>;
    assert.equal(canonicalizeJson(withUndef), '{"b":null,"c":1}');
  });
});

describe("hash: contentHash", () => {
  it("produces sha256:<64-hex> prefix", () => {
    const h = contentHash({ hello: "world" });
    assert.match(h, /^sha256:[0-9a-f]{64}$/);
  });

  it("is stable across key-order permutations", () => {
    const h1 = contentHash({ a: 1, b: 2 });
    const h2 = contentHash({ b: 2, a: 1 });
    assert.equal(h1, h2);
  });

  it("differs for meaningfully different inputs", () => {
    assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));
  });
});
