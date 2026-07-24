/**
 * Public type surface for `@appbana/prompt-template-registry`.
 */

export const PROMPT_REGISTRY_VERSION = "0.1";

export type PromptTemplateStatus = "active" | "deprecated";

export interface PromptTemplateMeta {
  /**
   * Reference of the form `prompt.<agent>.<task>`. Agent and task tokens are
   * `[a-z][a-z0-9-]*` and never contain dots — the dot separator is reserved.
   */
  readonly ref: string;
  /** SemVer `MAJOR.MINOR.PATCH`. */
  readonly version: string;
  readonly agent: string;
  readonly task: string;
  /** Relative path from the registry root to the template body file. */
  readonly file: string;
  /** `sha256:<hex>` of the canonicalized body (LF-normalized). */
  readonly sha256: string;
  readonly status: PromptTemplateStatus;
  readonly createdAt: string;
  readonly deprecatedAt?: string;
  /** Optional human-readable description shown in tooling. */
  readonly description?: string;
}

export interface PromptRegistryIndex {
  readonly registryVersion: typeof PROMPT_REGISTRY_VERSION;
  readonly templates: readonly PromptTemplateMeta[];
}

export interface PromptTemplate extends PromptTemplateMeta {
  /** Canonical (LF-normalized) template body. */
  readonly body: string;
}

export interface PromptRegistry {
  readonly rootDir: string;
  readonly index: PromptRegistryIndex;
  /** All templates keyed by `${ref}@${version}`. */
  readonly templates: ReadonlyMap<string, PromptTemplate>;
}

export interface RenderInput {
  readonly ref: string;
  readonly version: string;
  readonly variables?: Readonly<Record<string, string | number | boolean>>;
}

export interface RenderedPrompt {
  readonly ref: string;
  readonly version: string;
  /** Fully substituted template text — safe to send to a model. */
  readonly text: string;
  /**
   * `sha256:<hex>` of the RENDERED text. Adapters MUST embed this in
   * `AIProvenanceRecord.promptTemplateHash` so future queries can prove which
   * rendered prompt produced which output.
   */
  readonly hash: string;
  /** `sha256:<hex>` of the SOURCE template body (before variable substitution). */
  readonly templateHash: string;
}

/**
 * Descriptor of a historical provenance reference to check against the live
 * registry. Fed to `validateProvenanceRefs`.
 */
export interface ProvenanceRefRecord {
  readonly ref: string;
  readonly version: string;
  /** Optional: sha256 of the SOURCE template body seen at the time of the call. */
  readonly templateHash?: string;
}

export interface RegistryProblem {
  readonly code: RegistryProblemCode;
  readonly message: string;
  readonly ref?: string;
  readonly version?: string;
  readonly file?: string;
}

export type RegistryProblemCode =
  | "INDEX_MALFORMED"
  | "FILE_MISSING"
  | "HASH_MISMATCH"
  | "DUPLICATE_ENTRY"
  | "REF_MALFORMED"
  | "VERSION_MALFORMED"
  | "AGENT_TASK_MISMATCH"
  | "PROVENANCE_REF_MISSING"
  | "PROVENANCE_HASH_MISMATCH";
