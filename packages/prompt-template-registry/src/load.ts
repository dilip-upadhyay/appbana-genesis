/**
 * Filesystem loader for a prompt template registry.
 *
 * Reads `<rootDir>/index.json` and every referenced body file, canonicalizes
 * bodies, verifies declared hashes, and returns a fully hydrated
 * `PromptRegistry`. Any structural problem is thrown as a `RegistryError`
 * with a machine-readable `problems[]` list.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalizeBody, promptTemplateHash } from "./hash.js";
import type {
  PromptRegistry,
  PromptRegistryIndex,
  PromptTemplate,
  PromptTemplateMeta,
  RegistryProblem,
} from "./types.js";
import { PROMPT_REGISTRY_VERSION } from "./types.js";

const REF_PATTERN = /^prompt\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const AGENT_TASK_PATTERN = /^[a-z][a-z0-9-]*$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class RegistryError extends Error {
  readonly problems: readonly RegistryProblem[];
  constructor(problems: readonly RegistryProblem[]) {
    super(
      `prompt registry has ${problems.length} problem(s): ${problems
        .map((p) => `[${p.code}] ${p.message}`)
        .join("; ")}`,
    );
    this.name = "RegistryError";
    this.problems = problems;
  }
}

/**
 * Load a registry from disk. On any structural problem, throws
 * `RegistryError`; callers that want to surface issues rather than throw
 * should call `tryLoadRegistry` instead.
 */
export async function loadRegistry(rootDir: string): Promise<PromptRegistry> {
  const result = await tryLoadRegistry(rootDir);
  if (result.kind === "error") {
    throw new RegistryError(result.problems);
  }
  return result.registry;
}

export type LoadResult =
  | { readonly kind: "ok"; readonly registry: PromptRegistry }
  | { readonly kind: "error"; readonly problems: readonly RegistryProblem[] };

export async function tryLoadRegistry(rootDir: string): Promise<LoadResult> {
  const problems: RegistryProblem[] = [];
  let index: PromptRegistryIndex;
  try {
    const raw = await readFile(join(rootDir, "index.json"), "utf8");
    index = parseIndex(raw, problems);
  } catch (err) {
    problems.push({
      code: "INDEX_MALFORMED",
      message: `cannot read index.json: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { kind: "error", problems };
  }

  if (problems.length > 0) return { kind: "error", problems };

  const templates = new Map<string, PromptTemplate>();
  for (const meta of index.templates) {
    validateMeta(meta, problems);
    const key = `${meta.ref}@${meta.version}`;
    if (templates.has(key)) {
      problems.push({
        code: "DUPLICATE_ENTRY",
        message: `duplicate template entry ${key}`,
        ref: meta.ref,
        version: meta.version,
      });
      continue;
    }
    const body = await loadBody(rootDir, meta, problems);
    if (body === undefined) continue;
    const actualHash = promptTemplateHash(body);
    if (actualHash !== meta.sha256) {
      problems.push({
        code: "HASH_MISMATCH",
        message: `declared sha256 (${meta.sha256}) does not match on-disk canonical body (${actualHash})`,
        ref: meta.ref,
        version: meta.version,
        file: meta.file,
      });
      continue;
    }
    templates.set(key, { ...meta, body });
  }

  if (problems.length > 0) return { kind: "error", problems };
  return {
    kind: "ok",
    registry: { rootDir, index, templates },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseIndex(
  raw: string,
  problems: RegistryProblem[],
): PromptRegistryIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    problems.push({
      code: "INDEX_MALFORMED",
      message: `index.json is not valid JSON: ${err instanceof Error ? err.message : "parse error"}`,
    });
    return { registryVersion: PROMPT_REGISTRY_VERSION, templates: [] };
  }
  if (!isRecord(parsed)) {
    problems.push({
      code: "INDEX_MALFORMED",
      message: "index.json root must be an object",
    });
    return { registryVersion: PROMPT_REGISTRY_VERSION, templates: [] };
  }
  const versionField = parsed["registryVersion"];
  if (versionField !== PROMPT_REGISTRY_VERSION) {
    problems.push({
      code: "INDEX_MALFORMED",
      message: `unsupported registryVersion ${JSON.stringify(versionField)} (expected "${PROMPT_REGISTRY_VERSION}")`,
    });
  }
  const templatesField = parsed["templates"];
  if (!Array.isArray(templatesField)) {
    problems.push({
      code: "INDEX_MALFORMED",
      message: "index.json.templates must be an array",
    });
    return { registryVersion: PROMPT_REGISTRY_VERSION, templates: [] };
  }
  const templates: PromptTemplateMeta[] = [];
  for (const entry of templatesField) {
    const meta = coerceMeta(entry, problems);
    if (meta !== undefined) templates.push(meta);
  }
  return { registryVersion: PROMPT_REGISTRY_VERSION, templates };
}

function coerceMeta(
  raw: unknown,
  problems: RegistryProblem[],
): PromptTemplateMeta | undefined {
  if (!isRecord(raw)) {
    problems.push({
      code: "INDEX_MALFORMED",
      message: "templates[] entry must be an object",
    });
    return undefined;
  }
  const req = (k: string): string | undefined => {
    const v = raw[k];
    return typeof v === "string" ? v : undefined;
  };
  const ref = req("ref");
  const version = req("version");
  const agent = req("agent");
  const task = req("task");
  const file = req("file");
  const sha256 = req("sha256");
  const statusRaw = req("status");
  const createdAt = req("createdAt");
  if (
    ref === undefined ||
    version === undefined ||
    agent === undefined ||
    task === undefined ||
    file === undefined ||
    sha256 === undefined ||
    createdAt === undefined ||
    (statusRaw !== "active" && statusRaw !== "deprecated")
  ) {
    problems.push({
      code: "INDEX_MALFORMED",
      message: "templates[] entry missing required fields",
      ...(ref !== undefined ? { ref } : {}),
      ...(version !== undefined ? { version } : {}),
    });
    return undefined;
  }
  const deprecatedAt = req("deprecatedAt");
  const description = req("description");
  const meta: PromptTemplateMeta = {
    ref,
    version,
    agent,
    task,
    file,
    sha256,
    status: statusRaw,
    createdAt,
    ...(deprecatedAt !== undefined ? { deprecatedAt } : {}),
    ...(description !== undefined ? { description } : {}),
  };
  return meta;
}

function validateMeta(meta: PromptTemplateMeta, problems: RegistryProblem[]): void {
  if (!REF_PATTERN.test(meta.ref)) {
    problems.push({
      code: "REF_MALFORMED",
      message: `ref "${meta.ref}" does not match ${REF_PATTERN}`,
      ref: meta.ref,
      version: meta.version,
    });
  }
  if (!SEMVER_PATTERN.test(meta.version)) {
    problems.push({
      code: "VERSION_MALFORMED",
      message: `version "${meta.version}" is not a valid semver MAJOR.MINOR.PATCH`,
      ref: meta.ref,
      version: meta.version,
    });
  }
  if (!AGENT_TASK_PATTERN.test(meta.agent)) {
    problems.push({
      code: "AGENT_TASK_MISMATCH",
      message: `agent "${meta.agent}" does not match ${AGENT_TASK_PATTERN}`,
      ref: meta.ref,
    });
  }
  if (!AGENT_TASK_PATTERN.test(meta.task)) {
    problems.push({
      code: "AGENT_TASK_MISMATCH",
      message: `task "${meta.task}" does not match ${AGENT_TASK_PATTERN}`,
      ref: meta.ref,
    });
  }
  const expectedRef = `prompt.${meta.agent}.${meta.task}`;
  if (meta.ref !== expectedRef) {
    problems.push({
      code: "AGENT_TASK_MISMATCH",
      message: `ref "${meta.ref}" does not match "prompt.<agent>.<task>" (expected "${expectedRef}")`,
      ref: meta.ref,
    });
  }
}

async function loadBody(
  rootDir: string,
  meta: PromptTemplateMeta,
  problems: RegistryProblem[],
): Promise<string | undefined> {
  try {
    const raw = await readFile(join(rootDir, meta.file), "utf8");
    return canonicalizeBody(raw);
  } catch (err) {
    problems.push({
      code: "FILE_MISSING",
      message: `cannot read template body: ${err instanceof Error ? err.message : String(err)}`,
      ref: meta.ref,
      version: meta.version,
      file: meta.file,
    });
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
