import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  canonicalizeBody,
  promptTemplateHash,
  renderedPromptHash,
} from "../dist/index.js";

test("canonicalizeBody normalizes CRLF to LF", () => {
  assert.equal(canonicalizeBody("a\r\nb\r\n"), "a\nb\n");
});

test("canonicalizeBody normalizes bare CR to LF", () => {
  assert.equal(canonicalizeBody("a\rb\rc"), "a\nb\nc");
});

test("canonicalizeBody leaves LF-only content untouched", () => {
  const body = "line1\nline2\nline3\n";
  assert.equal(canonicalizeBody(body), body);
});

test("promptTemplateHash is stable across line-ending variants", () => {
  const lf = promptTemplateHash("hello\nworld\n");
  const crlf = promptTemplateHash("hello\r\nworld\r\n");
  const cr = promptTemplateHash("hello\rworld\r");
  assert.equal(lf, crlf);
  assert.equal(lf, cr);
  assert.match(lf, /^sha256:[0-9a-f]{64}$/);
});

test("promptTemplateHash differs for different content", () => {
  const a = promptTemplateHash("hello");
  const b = promptTemplateHash("hello!");
  assert.notEqual(a, b);
});

test("renderedPromptHash does NOT canonicalize", () => {
  const a = renderedPromptHash("hello\r\nworld");
  const b = renderedPromptHash("hello\nworld");
  assert.notEqual(a, b);
});
