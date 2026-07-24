/**
 * Deterministic prompt renderer.
 *
 * Substitutes `{{variable_name}}` placeholders in the template body with
 * caller-supplied values. In strict mode (the default), the renderer:
 *
 *   1. FAILS if the template references a placeholder that was not supplied.
 *   2. FAILS if the caller supplies a variable that the template never uses.
 *
 * Both rules together make the (template, variables) pair a total, closed
 * function — a property required for reproducibility.
 */

import { promptTemplateHash, renderedPromptHash } from "./hash.js";
import type {
  PromptRegistry,
  PromptTemplate,
  RenderInput,
  RenderedPrompt,
} from "./types.js";

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g;

export class RenderError extends Error {
  readonly ref: string;
  readonly version: string;
  readonly missingVariables: readonly string[];
  readonly unusedVariables: readonly string[];
  constructor(
    ref: string,
    version: string,
    missing: readonly string[],
    unused: readonly string[],
  ) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing variables: ${missing.join(", ")}`);
    if (unused.length > 0) parts.push(`unused variables: ${unused.join(", ")}`);
    super(
      `prompt ${ref}@${version} render failed — ${parts.join("; ")}`,
    );
    this.name = "RenderError";
    this.ref = ref;
    this.version = version;
    this.missingVariables = missing;
    this.unusedVariables = unused;
  }
}

export interface RenderOptions {
  /** When true (default), unused variables cause `RenderError`. */
  readonly strictUnused?: boolean;
}

export function renderPrompt(
  registry: PromptRegistry,
  input: RenderInput,
  options: RenderOptions = {},
): RenderedPrompt {
  const template = resolveTemplate(registry, input.ref, input.version);
  const variables = input.variables ?? {};
  const strictUnused = options.strictUnused ?? true;

  const referenced = collectPlaceholders(template.body);
  const supplied = new Set(Object.keys(variables));

  const missing = [...referenced]
    .filter((v) => !supplied.has(v))
    .sort((a, b) => a.localeCompare(b));
  const unused = strictUnused
    ? [...supplied]
        .filter((v) => !referenced.has(v))
        .sort((a, b) => a.localeCompare(b))
    : [];

  if (missing.length > 0 || unused.length > 0) {
    throw new RenderError(input.ref, input.version, missing, unused);
  }

  const text = template.body.replaceAll(
    PLACEHOLDER_PATTERN,
    (_, name: string) => {
      const value = variables[name];
      return value === undefined ? "" : String(value);
    },
  );

  return {
    ref: input.ref,
    version: input.version,
    text,
    hash: renderedPromptHash(text),
    templateHash: promptTemplateHash(template.body),
  };
}

/**
 * Look up a template. Throws if the (ref, version) is not registered.
 */
export function resolveTemplate(
  registry: PromptRegistry,
  ref: string,
  version: string,
): PromptTemplate {
  const key = `${ref}@${version}`;
  const template = registry.templates.get(key);
  if (template === undefined) {
    throw new RenderError(ref, version, ["<unknown-template>"], []);
  }
  return template;
}

function collectPlaceholders(body: string): ReadonlySet<string> {
  const set = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (typeof name === "string") set.add(name);
  }
  return set;
}
