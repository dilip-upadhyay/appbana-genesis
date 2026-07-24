/**
 * JSON-Schema layer of the AIM validator, built on top of Ajv 2020-12.
 *
 * Ajv 8.x ships as CommonJS; under this repo's `verbatimModuleSyntax: true` +
 * `module: "NodeNext"` tsconfig, static `import Ajv from "ajv/dist/2020.js"`
 * loses the constructor type. We use `createRequire` + `.default ?? namespace`
 * fallback \u2014 the canonical pattern for CJS libs in strict-ESM TS packages.
 */

import { createRequire } from "node:module";

import type { AimSchemaValidationError } from "./types.js";

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
const addFormatsModule = req("ajv-formats") as AddFormatsFn & {
  default?: AddFormatsFn;
};
const addFormats: AddFormatsFn = addFormatsModule.default ?? addFormatsModule;

export type CompiledSchemaValidator = (
  candidate: unknown,
) => readonly AimSchemaValidationError[];

export function compileSchemaValidator(
  schema: Readonly<Record<string, unknown>>,
  ajvStrict = true,
): CompiledSchemaValidator {
  const ajv = new Ajv2020({
    strict: ajvStrict,
    allErrors: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return (candidate) => {
    const ok = validate(candidate);
    if (ok === true) return [];
    return (validate.errors ?? []).map(toValidationError);
  };
}

function toValidationError(err: AjvErrorObject): AimSchemaValidationError {
  const path = err.instancePath === "" ? "/" : err.instancePath;
  const message = err.message ?? "validation failed";
  const detail = err.params ?? undefined;
  const base = { path, message, keyword: err.keyword };
  return detail === undefined ? base : { ...base, detail };
}
