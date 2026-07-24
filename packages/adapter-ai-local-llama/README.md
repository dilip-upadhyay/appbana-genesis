# @appbana/adapter-ai-local-llama

AI model adapter for a **locally hosted Llama 3.3 70B** instance. Certified for
air-gapped deployment mode: `requiresNetwork: false`,
`egressesInputsToThirdParty: false`.

## Bindings

| binding                 | kind                | response contract | streaming |
| ----------------------- | ------------------- | ----------------- | --------- |
| `ai:local-llama`        | `text-generation`   | `free-text`       | yes       |
| `ai:local-llama-json`   | `structured-output` | `json-schema`     | no        |

## Design (v0.1)

- **No inference runtime bundled.** The adapter never binds to a specific host
  process. Consumers inject a `LocalLlamaClient` via `LocalLlamaAdapterConfig.clientFactory`.
  The client interface is a subset of the OpenAI-compatible Chat Completions
  API, which is spoken by every mainstream local runtime:
  - **llama.cpp** (via `llama-server --api-server`)
  - **vLLM** (`--api-key` optional; served on `/v1/chat/completions`)
  - **Ollama** (via its OpenAI-compatible proxy on `/v1/chat/completions`)
  - **LM Studio** (built-in `/v1/chat/completions`)
- **Air-gapped by construction.** The default factory rejects at `init()` time
  with an instructive message. No outbound network calls are made by this
  package under any circumstance.
- **Determinism-friendly.** `supportsDeterminismHint: true`. When
  `request.seed` is set, the adapter forwards it and the same seed against the
  same model/prompt produces the same `outputHash`.
- **Data residency.** Every provenance record carries
  `modelProviderRegion === "on-prem"` (or the configured value); this matches
  the declared `dataResidencyGuarantee` and satisfies Tier A check A.4.
- **Structured output** = JSON via `response_format: { type: "json_object" }`
  plus schema-in-system-prompt + post-hoc `shapeCheck`. Full JSON Schema
  validation via Ajv is a v0.2 follow-up.
- **Redaction runs before any wire call** using
  [`@appbana/security-redaction`](../security-redaction/).

## Consumer wiring example (Ollama)

```ts
import { createClaudeStructuredOutputAdapter } from "@appbana/adapter-ai-local-llama";

const adapter = createLocalLlamaTextGenerationAdapter({
  clientFactory: async () => {
    return {
      chatCompletions: {
        async create(req, opts) {
          const res = await fetch("http://localhost:11434/v1/chat/completions", {
            method: "POST",
            body: JSON.stringify(req),
            headers: { "content-type": "application/json" },
            signal: opts?.signal,
          });
          return await res.json();
        },
        stream(req, opts) { /* SSE reader → AsyncIterable */ },
      },
    };
  },
});
```

## Conformance

Ships a self-test that runs
[`@appbana/ai-adapter-conformance-suite`](../ai-adapter-conformance-suite/)
Tier A against a deterministic fake `LocalLlamaClient`. Tier A ⊇ Tier B ⊇
Tier C: 15 checks executed, 1 (A.2 determinism) validates the seed path.

## Version

- Package: 0.1.0
- Kernel: `>= 0.1.0`
- Prompt template registry: not yet wired (Phase 1 follow-up)
