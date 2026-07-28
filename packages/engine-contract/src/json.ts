// @appbana/engine-contract — JSON value primitives.
//
// Engine inputs, outputs, effect payloads, and trace payloads must be plain
// JSON. This is not a stylistic preference: ADR-013 requires that an engine
// implemented in Rust, Go, or WASM be a first-class replacement for the
// TypeScript reference implementation. A contract that admitted class
// instances, functions, `Date` objects, or `undefined` would not survive a
// process or language boundary, and the byte-equality determinism check in the
// conformance suite would be meaningless.

/** A JSON value. The wire vocabulary of the entire engine contract. */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

/** A JSON object. */
export type JsonObject = { readonly [key: string]: Json };

/**
 * Structurally verifies that a value is JSON-safe.
 *
 * Used by the conformance suite to reject engines that return values which
 * cannot cross a language boundary. Deliberately rejects `undefined`,
 * functions, symbols, `Date`, `Map`, `Set`, and class instances with a
 * non-`Object` prototype — every one of which serialises lossily or throws.
 */
export function isJson(value: unknown): value is Json {
  return jsonViolation(value, "$") === undefined;
}

/**
 * Returns a JSON Pointer to the first non-JSON-safe location in `value`, or
 * `undefined` if the whole structure is JSON-safe.
 *
 * Returning the *path* rather than a boolean is deliberate — when a
 * conformance run fails, "not JSON-safe" is not an actionable message, but
 * "$.effects[2].data.createdAt is a Date" is.
 */
export function jsonViolation(
  value: unknown,
  path = "$",
  seen: Set<object> = new Set(),
): string | undefined {
  if (value === null) return undefined;

  const t = typeof value;
  if (t === "string" || t === "boolean") return undefined;

  if (t === "number") {
    // NaN and ±Infinity round-trip through JSON.stringify as `null`, silently
    // corrupting the value. A deterministic contract cannot allow that.
    return Number.isFinite(value) ? undefined : `${path} is ${String(value)}`;
  }

  if (t === "undefined") {
    return `${path} is undefined (use null, or omit the property entirely)`;
  }
  if (t === "function") return `${path} is a function`;
  if (t === "symbol") return `${path} is a symbol`;
  if (t === "bigint") return `${path} is a bigint (not representable in JSON)`;

  if (typeof value === "object") {
    if (seen.has(value)) return `${path} is a circular reference`;
    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const v = jsonViolation(value[i], `${path}[${i}]`, seen);
        if (v !== undefined) return v;
      }
      seen.delete(value);
      return undefined;
    }

    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return `${path} is a ${value.constructor?.name ?? "class"} instance, not a plain object`;
    }

    for (const [k, v] of Object.entries(value)) {
      const violation = jsonViolation(v, `${path}.${k}`, seen);
      if (violation !== undefined) return violation;
    }
    seen.delete(value);
    return undefined;
  }

  return `${path} has unsupported type ${t}`;
}

/**
 * Serialises a value with object keys sorted at every depth.
 *
 * The determinism check compares two `EngineResult`s byte-for-byte. Plain
 * `JSON.stringify` preserves insertion order, so two semantically identical
 * results built by different code paths would compare unequal. Canonicalising
 * removes that false positive without weakening the check — array order is
 * still significant, because array order is semantically meaningful in
 * `effects` and `traceEvents`.
 */
export function canonicalJson(value: Json): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: Json): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalise);

  const source = value as { readonly [key: string]: Json };
  const out: Record<string, Json> = {};
  for (const key of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
    out[key] = canonicalise(source[key] as Json);
  }
  return out;
}
