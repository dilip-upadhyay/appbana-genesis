/**
 * Public types for `@appbana/aim-validator`.
 */

export type AimDocument = Readonly<Record<string, unknown>>;

/**
 * Kinds of AIM top-level elements we track by unique id. Order matches the
 * corresponding array in the schema; only the entries we resolve references
 * against are included (nested state and transition ids are stored in a
 * separate table but not exposed here).
 */
export type AimSymbolKind =
  | "role"
  | "enum"
  | "entity"
  | "state-machine"
  | "operation"
  | "rule";

export interface AimSymbol {
  readonly kind: AimSymbolKind;
  readonly id: string;
  /** JSON Pointer to the definition site. */
  readonly definedAt: string;
}

export interface AimSymbolTable {
  /** All symbols keyed by id. */
  readonly byId: ReadonlyMap<string, AimSymbol>;
  /** Symbols grouped by kind. */
  readonly byKind: ReadonlyMap<AimSymbolKind, readonly AimSymbol[]>;
  /** Every occurrence of duplicate ids (same id defined twice). */
  readonly duplicates: readonly AimDuplicateIdError[];
}

export interface AimDuplicateIdError {
  readonly id: string;
  readonly kind: AimSymbolKind;
  readonly firstDefinedAt: string;
  readonly duplicateDefinedAt: string;
}

export interface AimReferenceError {
  /** JSON Pointer to the reference-carrying string. */
  readonly path: string;
  /** The unresolved id string. */
  readonly ref: string;
  /** Rule that fired the check. */
  readonly rule: string;
  /** Kinds the reference was expected to resolve to. */
  readonly expected: readonly AimSymbolKind[];
  /** Present when the ref matched a known prefix but the id didn't exist. */
  readonly closestSuggestion?: string;
  readonly message: string;
}

export interface AimSchemaValidationError {
  /** JSON Pointer to the offending value. `""` normalized to `/`. */
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
  readonly detail?: unknown;
}

export interface AimValidationReport {
  /** True iff `schemaErrors`, `referenceErrors`, and `duplicateIds` are all empty. */
  readonly valid: boolean;
  readonly schemaErrors: readonly AimSchemaValidationError[];
  readonly referenceErrors: readonly AimReferenceError[];
  readonly duplicateIds: readonly AimDuplicateIdError[];
  /** Short human summary suitable for logs. */
  readonly summary: string;
}

/**
 * Rule that classifies a property key as a reference-carrier.
 *
 * The AIM does NOT have a formal `$ref` grammar at v0.1 — cross-references live
 * on well-known keys (`enumRef`, `entityRef`, `assignedTo`, ...). Each rule
 * declares the key, whether the value is a scalar or array, and which symbol
 * kinds are legal targets.
 */
export interface AimReferenceRule {
  readonly key: string;
  readonly cardinality: "scalar" | "array";
  readonly expects: readonly AimSymbolKind[];
  /**
   * When true (default), an `operation.<x>` value MAY carry a trailing
   * `:v<N>` version suffix that will be stripped before symbol lookup.
   */
  readonly allowVersionSuffix?: boolean;
}

export interface ValidateAimOptions {
  /**
   * Parsed AIM v0.1 JSON Schema. When omitted, schema validation is skipped
   * (only symbol / reference / duplicate checks run).
   */
  readonly schema?: Readonly<Record<string, unknown>>;
  /**
   * Override the reference-rule set. Defaults to the v0.1 built-in ruleset
   * exported as `DEFAULT_AIM_REFERENCE_RULES`.
   */
  readonly referenceRules?: readonly AimReferenceRule[];
  /**
   * Ajv `strict` mode toggle. Default `true`.
   */
  readonly ajvStrict?: boolean;
}
