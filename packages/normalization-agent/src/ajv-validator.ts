/**
 * Default AIM validator built on top of Ajv 2020-12.
 *
 * The Normalization Agent does not depend on a specific validation engine \u2014 it
 * consumes an {@link AimValidator} function. This module provides one such
 * function pre-wired for the AIM v0.1 JSON Schema; callers may replace it with
 * a custom validator (for example, `@appbana/aim-validator` which will add
 * cross-reference resolution on top).
 *
 * Ajv 8.x ships as CommonJS. Under this repo's `verbatimModuleSyntax: true` +
 * `module: "NodeNext"` tsconfig, static `import Ajv from "ajv/dist/2020.js"`
 * loses the constructor type. We use {@link createRequire} for explicit CJS
 * interop \u2014 same pattern used across other Node ESM + strict TS setups.
 */

import { createRequire } from "node:module";

import type { AimValidationError, AimValidationResult, AimValidator } from "./types.js";

interface AjvErrorObject {
  readonly instancePath: string;
  readonly message?: string;
  readonly keyword: string;
  readonly params?: Readonly<Record<string, unknown>>;
}
type AjvValidateFunction = ((data: unknown) => boolean) & {
  errors?: readonly AjvErrorObject[] | null;
};
interface AjvInstance {
  compile(schema: unknown): AjvValidateFunction;
  addSchema(schema: unknown): void;
}
type AjvCtor = new (options: Readonly<Record<string, unknown>>) => AjvInstance;
type AddFormatsFn = (ajv: AjvInstance) => void;

const req = createRequire(import.meta.url);
const ajv2020Module = req("ajv/dist/2020.js") as AjvCtor & { default?: AjvCtor };
const Ajv2020: AjvCtor = ajv2020Module.default ?? ajv2020Module;
const addFormatsModule = req("ajv-formats") as AddFormatsFn & { default?: AddFormatsFn };
const addFormats: AddFormatsFn = addFormatsModule.default ?? addFormatsModule;

export interface CreateAjvAimValidatorOptions {
  /**
   * Parsed AIM JSON Schema (contents of `docs/schemas/aim.v0.2.schema.json`).
   * The caller loads it from disk / bundled asset / URL \u2014 the agent must NOT
   * assume a filesystem location.
   */
  readonly schema: Readonly<Record<string, unknown>>;
  /**
   * Optional supporting schemas registered before compilation
   * (referenced via `$ref`). Not required for the packaged AIM v0.1 schema \u2014
   * kept for forward compatibility when related schemas are extracted.
   */
  readonly extraSchemas?: readonly Readonly<Record<string, unknown>>[];
  /**
   * When true (default), Ajv's `strict` mode is enabled. Setting `false`
   * relaxes checks on unknown keywords \u2014 useful only for exploratory schemas.
   */
  readonly strict?: boolean;
}

export function createAjvAimValidator(
  options: CreateAjvAimValidatorOptions,
): AimValidator {
  const strict = options.strict ?? true;
  const ajv = new Ajv2020({
    strict,
    allErrors: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  for (const extra of options.extraSchemas ?? []) {
    ajv.addSchema(extra);
  }
  const validate = ajv.compile(options.schema);

  return (candidate: unknown): AimValidationResult => {
    const ok = validate(candidate);
    if (ok === true) {
      return { valid: true, errors: [] };
    }
    const rawErrors = validate.errors ?? [];
    const errors: readonly AimValidationError[] = rawErrors.map(toValidationError);
    return { valid: false, errors };
  };
}

function toValidationError(err: AjvErrorObject): AimValidationError {
  const path = err.instancePath === "" ? "/" : err.instancePath;
  const message = err.message ?? "validation failed";
  const detail = err.params ?? undefined;
  const base = { path, message, keyword: err.keyword };
  return detail === undefined ? base : { ...base, detail };
}
