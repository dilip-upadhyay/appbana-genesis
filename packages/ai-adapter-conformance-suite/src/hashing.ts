/**
 * Shared hash helpers used by the runner and by check assertions.
 */

/** Regex matching a canonical `sha256:<64-lowercase-hex>` string. */
export const SHA256_HEX_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/**
 * True iff the given value is a canonical `sha256:<hex>` string. Used by the
 * provenance shape check to validate hash fields without importing crypto.
 */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}
