import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeJson, contentHash, sha256Hex } from "../dist/index.js";

test("canonicalizeJson sorts object keys deterministically", () => {
  const a = JSON.stringify(canonicalizeJson({ b: 1, a: 2, c: { z: 1, y: 2 } }));
  const b = JSON.stringify(canonicalizeJson({ c: { y: 2, z: 1 }, a: 2, b: 1 }));
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1,"c":{"y":2,"z":1}}');
});

test("canonicalizeJson drops undefined but preserves null", () => {
  const s = JSON.stringify(canonicalizeJson({ a: undefined, b: null, c: 1 }));
  assert.equal(s, '{"b":null,"c":1}');
});

test("sha256Hex is 64 lowercase hex chars", () => {
  const h = sha256Hex("abc");
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("contentHash yields byte-identical output for byte-identical input", () => {
  const doc = { b: 1, a: [3, 2, 1] };
  const h1 = contentHash(doc);
  const h2 = contentHash({ a: [3, 2, 1], b: 1 });
  assert.equal(h1, h2);
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
});

test("contentHash differs for semantically different documents", () => {
  const h1 = contentHash({ a: 1 });
  const h2 = contentHash({ a: 2 });
  assert.notEqual(h1, h2);
});
