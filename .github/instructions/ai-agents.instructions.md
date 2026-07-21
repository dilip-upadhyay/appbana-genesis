---
description: "Use when implementing or modifying AI agents, the multi-model adapter layer, prompt templates, the BIM-to-AIM translation pipeline, or AI provenance recording. Covers agent responsibilities, the model adapter interface, provenance schema, prompt versioning, and the eval framework."
applyTo: "packages/ai-application-agent/**,packages/adapter-ai-*/**"
---

# AI Agent & Model Adapter Instructions

## Agent Responsibilities

AppBana Genesis uses AI agents for **intake and translation only** — never for execution.

| Agent | Responsibility | Output |
|---|---|---|
| **BA Agent** | Conversational intake — extract business intent from chat/audio/documents | Partial BIM, clarification questions |
| **Clarification Agent** | Identify gaps in BIM, generate targeted questions for the user | Clarification requests → completed BIM |
| **Normalization Agent** | Map business terms to canonical AIM types | AIM draft |
| **Resolution Agent** | Resolve references, apply defaults, expand inheritance | Fully resolved AIM |
| **Validation Agent** | Schema-validate AIM, check semantic completeness | Validated AIM or validation errors |
| **Migration Agent** | Propose BIM/AIM/CAM patches when platform schema evolves | Diff-ready patch proposals |

## The Translation Pipeline

```
BIM (complete) → Normalization Agent → AIM draft → Resolution Agent → AIM resolved → Validation Agent → AIM validated
```

Each stage is a separate agent call with its own prompt template, input schema, output schema, and provenance record. No stage skips the next — each stage's output is the next stage's validated input.

## Multi-Model Adapter Interface

Never call a model SDK directly. Always use the adapter interface:

```typescript
interface AIModelAdapter {
  readonly modelId: string;          // e.g. "anthropic.claude-sonnet-4-5"
  readonly providerId: string;       // e.g. "anthropic" | "openai" | "llama"

  complete(request: AgentPromptContract): Promise<AICompletionResult>;
}

interface AgentPromptContract {
  templateId: string;               // registered template ID
  templateVersion: string;          // semver of the prompt template
  role: AgentRole;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  input: unknown;
  tools?: ToolDefinition[];
  budget: { maxTokens: number; maxCostUSD?: number };
  deterministic: boolean;           // if true, temperature=0 enforced
}

interface AICompletionResult {
  output: unknown;                  // validated against AgentPromptContract.outputSchema
  provenance: AIProvenance;
  usage: TokenUsage;
}
```

## Provenance Record (mandatory on every AI call)

```typescript
interface AIProvenance {
  provenanceId: string;             // UUID
  modelId: string;                  // exact model used (not alias)
  modelVersion: string;             // model checkpoint/version if available
  templateId: string;
  templateVersion: string;
  inputHash: string;                // SHA-256 of serialized input
  outputHash: string;               // SHA-256 of serialized output
  tokenCount: { prompt: number; completion: number; total: number };
  latencyMs: number;
  timestamp: string;                // ISO-8601
  humanReviewerId?: string;         // set if human approved this output
  humanReviewedAt?: string;
}
```

Every provenance record is stored in the Metadata Registry and linked to the BIM/AIM/CAM artifact it produced.

## Prompt Template Conventions

- Templates live in `packages/ai-application-agent/prompts/{agentRole}/{templateId}.v{version}.md`.
- Template body uses `{{variable_name}}` placeholders — same convention as VS Code Copilot.
- System prompt and user prompt are separate sections in the template file.
- Templates are versioned independently of the agent code — bumping a template version creates a new provenance lineage.
- Never interpolate user-supplied content directly into a system prompt — always into the user turn.

## Default Model Assignments

| Agent | Cloud model | On-prem model |
|---|---|---|
| BA Agent (chat) | Claude Sonnet 4.5 | Llama 3.3 70B |
| BA Agent (speech) | Whisper (transcription) + Claude Sonnet 4.5 | Whisper local + Llama 3.3 70B |
| Normalization Agent | Claude Sonnet 4.5 | Llama 3.3 70B |
| Resolution Agent | GPT-4o (strong at reference resolution) | Llama 3.3 70B |
| Validation Agent | GPT-4o | Llama 3.3 70B |
| Migration Agent | Claude Sonnet 4.5 | Llama 3.3 70B |

Assignments are configuration — not hard-coded. An operator may override per-agent per-tenant.

## Eval Framework (mandatory from Phase 0)

Every agent must have an eval suite in `packages/ai-application-agent/evals/{agentRole}/`:
- `cases/` — input fixtures (BIMs, conversation transcripts, etc.)
- `expectations/` — expected outputs (AIMs, clarification questions, etc.)
- `metrics.ts` — scoring function (exact match, schema validity, semantic similarity threshold)
- `eval.ts` — runs all cases, reports pass/fail/score per case

Eval suite runs in CI on every change to a prompt template or agent code.

## Security Rules for AI Agents

- Never log raw user input to stdout or structured logs — it may contain PII.
- Never pass a previous AI output directly as a subsequent AI input without validation — always validate against the expected schema first (prevents prompt injection propagation).
- System prompts must not contain tenant-specific data — tenant context goes in the user turn only.
- AI-generated patches to BIM/AIM/CAM are **proposals** — they require the governance publication gate (including human approval for production activation). Never auto-apply.

## LangGraph Conventions (if LangGraph wins the spike)

- Each agent is a LangGraph `StateGraph` node.
- Shared state is the `IntentContext` (carries BIM draft, clarifications, AIM draft, provenance chain).
- Human-in-the-loop pauses use LangGraph's `interrupt_before` at the clarification and validation nodes.
- Graph definition files live in `packages/ai-application-agent/graphs/`.
- No business logic in graph edge conditions — only routing based on agent output type.
