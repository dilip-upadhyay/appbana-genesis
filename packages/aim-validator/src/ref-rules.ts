/**
 * Default AIM v0.1 reference-rule set.
 *
 * The rules enumerate every well-known property key that carries a cross-reference
 * to another AIM element (as of the seed Customer Onboarding scenario). Each rule
 * declares:
 *   - the key name (matched exactly at any depth),
 *   - whether the value is a scalar string or a string[],
 *   - which symbol kinds are legal targets,
 *   - whether a `:v<N>` suffix should be stripped before symbol lookup (operations
 *     may be referenced with an explicit version pin).
 *
 * Callers may override with `ValidateAimOptions.referenceRules` when their AIM
 * dialect introduces new ref-carrying keys.
 */

import type { AimReferenceRule } from "./types.js";

export const DEFAULT_AIM_REFERENCE_RULES: readonly AimReferenceRule[] = [
  { key: "enumRef", cardinality: "scalar", expects: ["enum"] },
  { key: "entityRef", cardinality: "scalar", expects: ["entity"] },
  { key: "stateMachineRef", cardinality: "scalar", expects: ["state-machine"] },
  { key: "referenceTo", cardinality: "scalar", expects: ["entity", "role"] },
  { key: "assignedTo", cardinality: "scalar", expects: ["role"] },
  { key: "derivedFrom", cardinality: "scalar", expects: ["rule"] },
  {
    key: "triggeredBy",
    cardinality: "scalar",
    expects: ["operation"],
    allowVersionSuffix: true,
  },
  { key: "allowedRoles", cardinality: "array", expects: ["role"] },
  { key: "allowRoles", cardinality: "array", expects: ["role"] },
  { key: "denyRoles", cardinality: "array", expects: ["role"] },
  { key: "canAssumeAny", cardinality: "array", expects: ["role"] },

  // Rule-expression operands used inside guards. `ref` and `role-is` sit inside
  // guard expressions; `entity` sits inside rule targets / operands. All three
  // ignore values that do not begin with a known kind prefix, so we never
  // false-positive on free-form strings.
  { key: "ref", cardinality: "scalar", expects: ["rule"] },
  { key: "role-is", cardinality: "scalar", expects: ["role"] },
  { key: "entity", cardinality: "scalar", expects: ["entity"] },
];
