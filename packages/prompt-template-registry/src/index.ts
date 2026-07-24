/**
 * Public API for `@appbana/prompt-template-registry`.
 */

export {
  PROMPT_REGISTRY_VERSION,
  type PromptTemplateMeta,
  type PromptTemplateStatus,
  type PromptTemplate,
  type PromptRegistry,
  type PromptRegistryIndex,
  type RenderInput,
  type RenderedPrompt,
  type ProvenanceRefRecord,
  type RegistryProblem,
  type RegistryProblemCode,
} from "./types.js";

export {
  canonicalizeBody,
  promptTemplateHash,
  renderedPromptHash,
} from "./hash.js";

export {
  loadRegistry,
  tryLoadRegistry,
  RegistryError,
  type LoadResult,
} from "./load.js";

export {
  renderPrompt,
  resolveTemplate,
  RenderError,
  type RenderOptions,
} from "./render.js";

export {
  validateRegistry,
  validateProvenanceRefs,
} from "./validate.js";
