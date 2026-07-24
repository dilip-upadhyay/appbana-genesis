# @appbana/prompt-template-registry

Versioned, content-addressed registry for AI agent prompt templates.

## Why

AppBana Genesis records an `AIProvenanceRecord` for every AI call, and every
record embeds `promptTemplateRef`, `promptTemplateVersion`, and
`promptTemplateHash`. Reproducibility of past AI decisions depends on those
three fields still resolving to the exact same prompt text years later. This
package is the storage + enforcement layer that makes that guarantee.

## Layout

```
prompts/
├── index.json                            ← machine-readable manifest
├── ba-agent/
│   └── intake.1.0.0.prompt.md
└── normalization-agent/
    └── bim-to-aim.1.0.0.prompt.md
```

### Ref + version convention

- **Ref** — `prompt.<agent>.<task>` (e.g. `prompt.ba-agent.intake`).
  Agent and task are `[a-z][a-z0-9-]*`. No dots allowed inside agent/task
  because the ref itself uses dot as a separator.
- **Version** — SemVer `MAJOR.MINOR.PATCH`.
- **File name** — `<task>.<version>.prompt.md` on disk under `<agent>/`.

### Hashing

The registry stores `sha256:<hex>` of the **canonicalized** template body.
Canonicalization normalizes line endings to `\n` before hashing so a Windows
checkout and a Linux checkout of the same commit produce identical hashes.

## Public API

```ts
import {
  loadRegistry,
  renderPrompt,
  validateRegistry,
  validateProvenanceRefs,
  promptTemplateHash,
} from "@appbana/prompt-template-registry";

const registry = await loadRegistry("./prompts");

const rendered = renderPrompt(registry, {
  ref: "prompt.ba-agent.intake",
  version: "1.0.0",
  variables: { tenantName: "Acme Bank" },
});

// AI adapter provenance records embed rendered.hash as promptTemplateHash.
```

## CI enforcement

The `prompt-registry-check` CLI verifies **on every PR**:

1. `index.json` is well-formed and references only existing files.
2. Every declared `sha256` matches the on-disk file's canonical hash.
3. No `(ref, version)` pair is duplicated.
4. No template referenced by any historical `AIProvenanceRecord` has been
   deleted or mutated (fed via `--provenance-refs <file>`).

Add to CI:

```
pnpm --filter @appbana/prompt-template-registry check-registry
```

## Immutability policy

- New versions are additive. Bumping a template = new file + new entry.
- **Existing files MUST NOT be mutated.** If a template needs a fix, cut
  a new patch version.
- Deprecation is metadata-only (`status: "deprecated"`); it never removes
  the file. Removal is only permitted after CI confirms **zero references
  remain in any queried provenance store** — a Phase 2+ operation with a
  dedicated migration ADR.
