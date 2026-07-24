/**
 * Redaction engine tests. All cases run against the default rule set unless a
 * bespoke rule is required.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  SECURITY_REDACTION_VERSION,
  defaultRedactionRules,
  redact,
  type RedactionRule,
} from "../dist/index.js";

test("version constant is 0.1.0", () => {
  assert.equal(SECURITY_REDACTION_VERSION, "0.1.0");
});

test("SSN in a top-level string is masked and recorded", () => {
  const { redactedInputs, redactions } = redact(
    { message: "My SSN is 123-45-6789." },
    defaultRedactionRules,
  );
  assert.equal(redactedInputs["message"], "My SSN is [REDACTED].");
  assert.equal(redactions.length, 1);
  assert.equal(redactions[0]?.path, "/inputs/message");
  assert.equal(redactions[0]?.classification, "pii.high");
  assert.equal(redactions[0]?.action, "masked");
});

test("multiple rules on the same field produce multiple entries", () => {
  const { redactedInputs, redactions } = redact(
    { note: "Reach jane@example.com or SSN 123-45-6789." },
    defaultRedactionRules,
  );
  assert.equal(
    redactedInputs["note"],
    "Reach [REDACTED] or SSN [REDACTED].",
  );
  const paths = redactions.map((r) => `${r.classification}@${r.path}`);
  assert.ok(paths.includes("pii.high@/inputs/note"));
  assert.ok(paths.includes("pii.medium@/inputs/note"));
});

test("clean input produces zero redactions", () => {
  const { redactedInputs, redactions } = redact(
    { message: "hello world" },
    defaultRedactionRules,
  );
  assert.equal(redactedInputs["message"], "hello world");
  assert.equal(redactions.length, 0);
});

test("nested objects and arrays are walked with JSON Pointer paths", () => {
  const { redactedInputs, redactions } = redact(
    {
      customer: {
        name: "Jane",
        contacts: [
          { email: "jane@example.com" },
          { phone: "(555) 123-4567" },
        ],
      },
    },
    defaultRedactionRules,
  );
  const paths = redactions.map((r) => r.path).sort();
  assert.deepEqual(paths, [
    "/inputs/customer/contacts/0/email",
    "/inputs/customer/contacts/1/phone",
  ]);
  const contacts =
    (redactedInputs["customer"] as { contacts: unknown[] }).contacts;
  assert.deepEqual(contacts[0], { email: "[REDACTED]" });
  assert.deepEqual(contacts[1], { phone: "[REDACTED]" });
});

test("hashed action replaces the match with sha256:<hex>", () => {
  const rule: RedactionRule = {
    id: "rule.custom.token",
    classification: "secret.high",
    action: "hashed",
    pattern: /token-[a-z0-9]+/g,
  };
  const { redactedInputs, redactions } = redact(
    { auth: "bearer token-abc123" },
    [rule],
  );
  const value = redactedInputs["auth"] as string;
  assert.match(value, /^bearer sha256:[0-9a-f]{16}$/);
  assert.equal(redactions.length, 1);
  assert.equal(redactions[0]?.action, "hashed");
});

test("removed action nulls the whole field", () => {
  const rule: RedactionRule = {
    id: "rule.custom.remove",
    classification: "secret.high",
    action: "removed",
    pattern: /^apikey:/,
  };
  const { redactedInputs, redactions } = redact(
    { creds: "apikey:xyz" },
    [rule],
  );
  assert.equal(redactedInputs["creds"], null);
  assert.equal(redactions.length, 1);
  assert.equal(redactions[0]?.action, "removed");
});

test("policyRef is propagated to the emitted redaction entry", () => {
  const [entry] = redact(
    { m: "123-45-6789" },
    defaultRedactionRules,
  ).redactions;
  assert.equal(entry?.policyRef, "policy.default-pii-mask.v1");
});

test("field keys containing slash or tilde are correctly encoded", () => {
  const inputs = { "a/b": "SSN 123-45-6789", "c~d": "SSN 999-88-7777" };
  const { redactions } = redact(inputs, defaultRedactionRules);
  const paths = redactions.map((r) => r.path).sort();
  assert.deepEqual(paths, ["/inputs/a~1b", "/inputs/c~0d"]);
});

test("regex pattern state does not leak across values", () => {
  // Global flag maintains lastIndex on the SAME instance; the engine must
  // clone before use so consecutive matches all fire.
  const { redactions } = redact(
    { a: "123-45-6789", b: "999-88-7777", c: "111-22-3333" },
    defaultRedactionRules,
  );
  const paths = redactions.map((r) => r.path).sort();
  assert.deepEqual(paths, ["/inputs/a", "/inputs/b", "/inputs/c"]);
});
