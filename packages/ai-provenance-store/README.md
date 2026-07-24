# `@appbana/ai-provenance-store`

Append-only store for `AIProvenanceRecord` (per [ADR-015](../../docs/adr/ADR-015-ai-model-adapter-layer.md)). Every AI invocation the platform makes MUST land here. The kernel `assertProvenance` guard rejects any AI output whose record is missing or malformed.

## Contract

```ts
interface AIProvenanceStore {
  record(record: AIProvenanceRecord): Promise<StoredEntry>;
  get(id: string): Promise<StoredEntry | undefined>;
  query(filter: ProvenanceQuery): Promise<StoredEntry[]>;
  count(filter?: ProvenanceQuery): Promise<number>;
  listReferencedPromptVersions(): Promise<ProvenanceRefRecord[]>;
}
```

Where `StoredEntry = { id, insertedAt, record }`. Records are **append-only** — no update, no delete. `id` is a content-addressed sha-256 of the canonicalized record, so identical records dedupe (the same invocation cannot be double-recorded).

## `listReferencedPromptVersions()`

Feeds the CI enforcement gate:

```powershell
prompt-registry-check ./prompts --provenance-refs (./ai-provenance-dump.js)
```

Returns one `ProvenanceRefRecord` per distinct `(promptTemplateRef, promptTemplateVersion, promptTemplateHash)` triple observed in the store. `prompt-registry-check` fails CI if the live prompt registry has dropped or mutated any referenced version. Together these enforce the ADR-015 "prompt versions are append-only for the life of any referencing provenance" rule.

## Reference backends

| Backend | Package export | Durability | Concurrency | Intended use |
|---|---|---|---|---|
| In-memory | `InMemoryAIProvenanceStore` | process lifetime | single-writer | tests, ephemeral demos |
| JSONL-file | `JsonlAIProvenanceStore` | append to file, one JSON object per line | single-writer per file | local dev, air-gapped demo |
| Postgres | (v0.2) | durable, HA | multi-writer | production SaaS & dedicated cloud |

The Postgres DDL ships now at [`sql/ai_provenance.sql`](sql/ai_provenance.sql) so ops can pre-provision the table; the driver is a v0.2 follow-up (blocked on `pg` peer-dep decision).

## Kernel guard

```ts
import { assertProvenance } from "@appbana/ai-provenance-store";

const stored = await store.record(result.provenance);
assertProvenance(result, stored); // throws MissingProvenanceError if missing/invalid
```

`assertProvenance` verifies:

1. `result.provenance` is present.
2. Every mandatory field (`aiProvenanceVersion`, `modelName`, `modelVersion`, `promptTemplateRef`, `promptTemplateVersion`, `promptTemplateHash`, `inputHash`, `outputHash`, `requestingAgent`, `requestedAt`, `completedAt`, `wallClockMs`) is populated.
3. `stored.id` matches the sha-256 of the record just handed back — proving the store did not silently mutate.

Failing any check throws `MissingProvenanceError` with an actionable diagnostic. The kernel treats this as fail-closed.

## Immutability rule

The invariant behind the whole subsystem: **you may add rows, you may query rows, you must never mutate or delete rows in `ai_provenance` while any pointer or downstream artifact references them.** Retention is a governance decision, not an implementation one — see ADR-017.
