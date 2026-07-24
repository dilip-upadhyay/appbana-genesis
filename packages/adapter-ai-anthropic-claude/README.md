# @appbana/adapter-ai-anthropic-claude

Reference AI Model Adapter for **Anthropic Claude** — implements both the `text-generation` and `structured-output` kinds of the [ADR-015](../../docs/adr/ADR-015-ai-model-adapter-layer.md) `AIModelAdapter` contract.

- **Bindings:** `ai:anthropic-claude` (text-generation), `ai:anthropic-claude-json` (structured-output).
- **Conformance:** passes [`@appbana/ai-adapter-conformance-suite`](../ai-adapter-conformance-suite/) Tier B with the bundled test client. Tier A depends on tenant `SecurityModel` wiring in the kernel.
- **Redaction:** pre-network via [`@appbana/security-redaction`](../security-redaction/) — no input crosses the wire without redactions being recorded on the provenance record.

## Design notes

### The SDK is not bundled

v0.1 exposes a minimal [`AnthropicClient`](src/client.ts) interface and requires callers to inject a `clientFactory`. This keeps the adapter tree-shakeable and the reference implementation free of network deps during test.

In production, wire the real SDK:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createClaudeTextGenerationAdapter } from "@appbana/adapter-ai-anthropic-claude";

const adapter = createClaudeTextGenerationAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  modelName: "claude-sonnet-4-5",
  modelVersion: "2026-06",
  region: "us-east-1",
  clientFactory: async (cfg) => {
    const client = new Anthropic({ apiKey: cfg.apiKey });
    return {
      messages: {
        create: (req, opts) =>
          client.messages.create(req, { signal: opts?.signal }),
        stream: (req, opts) =>
          client.messages.stream(req, { signal: opts?.signal }),
      },
    };
  },
});
```

A follow-up (`v0.2`) will publish a `@appbana/adapter-ai-anthropic-claude/sdk` sub-export that bundles this wiring.

### Structured output

v0.1 uses the "schema-in-system-prompt + post-hoc validation" convention:

1. The adapter serialises the request's JSON Schema into the system prompt.
2. The response is parsed; on JSON parse or schema-shape mismatch the adapter returns `outcome: "schema-invalid"` with a structured diagnostic — never throws.
3. On success the parsed JSON becomes `result.artifact`.

Tool-use enforcement (Anthropic's stricter path) is a follow-up.

### Redaction

Every `invoke()` and `invokeStream()` runs the caller-supplied (or default) `RedactionRule[]` over `request.inputs` **before** constructing the Anthropic request. Every rule that fires adds a `AIProvenanceRedaction` entry to `result.provenance.redactions`.

### Budgets

`AIBudget.maxCostUsd` is enforced by pre-estimating input tokens (cheap heuristic) and reserving `max_tokens`. If the estimated worst-case cost exceeds the budget, the adapter returns `outcome: "budget-exceeded"` **before** the network call.

### Streaming

`invokeStream()` yields `AIInvocationChunk` records mapped from Anthropic `content_block_delta` events. The terminal chunk carries the final `AIProvenanceRecord`.

## Non-goals (v0.1)

- Not a rate-limiter — the caller composes rate limiting via the kernel's back-pressure layer.
- Not a retry mechanism — the injected `AnthropicClient` may add retries per its own conventions.
- No native tool-use — see the structured-output follow-up above.
