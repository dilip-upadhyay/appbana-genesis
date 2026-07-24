// Ajv 2020-12 loader — matches the CJS-interop pattern used across the
// workspace (see @appbana/normalization-agent, @appbana/aim-validator,
// @appbana/canonical-application-generator). Under
// `verbatimModuleSyntax: true` + `module: NodeNext` the static ESM import of
// `ajv/dist/2020.js` loses its constructor type; the createRequire trick is
// the recommended workaround.

import { createRequire } from "node:module";

type AjvCtor = new (options?: unknown) => AjvInstance;
type CompiledValidator = ((data: unknown) => boolean) & {
  errors?: readonly AjvErrorObject[] | null;
};
type AjvInstance = {
  compile: (schema: unknown) => CompiledValidator;
  addFormat: (name: string, format: unknown) => AjvInstance;
  errors: readonly AjvErrorObject[] | null;
};

/** Structural mirror of Ajv's ErrorObject — the only fields we consume. */
export interface AjvErrorObject {
  readonly instancePath: string;
  readonly schemaPath?: string;
  readonly keyword: string;
  readonly message?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

const req = createRequire(import.meta.url);

interface FormatsModule {
  (ajv: AjvInstance): AjvInstance;
  default?: (ajv: AjvInstance) => AjvInstance;
}

/**
 * Return a compiled validator for `schema`. The returned function returns the
 * errors array (empty when the value passes) so callers can inspect keyword +
 * instancePath without importing Ajv types.
 */
export function compileValidator(
  schema: unknown,
): (data: unknown) => readonly AjvErrorObject[] {
  const mod = req("ajv/dist/2020.js") as AjvCtor & { default?: AjvCtor };
  const Ajv2020 = mod.default ?? mod;

  const formatsMod = req("ajv-formats") as FormatsModule;
  const addFormats = formatsMod.default ?? formatsMod;

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  addFormats(ajv);

  const compiled = ajv.compile(schema);
  return (data: unknown) => {
    const ok = compiled(data);
    if (ok) return [];
    return (compiled.errors ?? ajv.errors ?? []) as readonly AjvErrorObject[];
  };
}
