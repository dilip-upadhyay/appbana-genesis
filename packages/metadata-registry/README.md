# @appbana/metadata-registry

Append-only, content-addressed store for the **BIM → AIM → CAM** artifact triple.

Every artifact — a `BIM` (business-language), `AIM` (canonical intent), or `CAM` (kernel input) — is keyed by the **sha-256 of its canonicalised JSON bytes**. Two writes of the same bytes return the pre-existing row (idempotent by content hash). Reads recompute the hash and throw `ContentHashMismatchError` on drift, giving read-time tamper detection. Ships three drivers:

| Backend | When to use |
|---|---|
| `InMemoryMetadataRegistry` | Tests, short-lived processes, unit demos |
| `JsonlMetadataRegistry` | Local dev, air-gapped installs (durable append-only file) |
| `PostgresMetadataRegistry` | Production — RLS-enforced multi-tenant table |

Satisfies **WS-1.3 Task 5** of the Phase 1 plan: append-only Postgres table storing BIM/AIM/CAM by content-hash; query API by `(appId, artifactKind, version)`; content-address integrity checked on read.

## Public API

```ts
import {
  InMemoryMetadataRegistry,
  JsonlMetadataRegistry,
  PostgresMetadataRegistry,
  computeContentHash,
  verifyContentHash,
  verifyProvenanceChain,
  ContentHashMismatchError,
  ProvenanceChainMismatchError,
} from "@appbana/metadata-registry";
```

### Core interface

```ts
interface MetadataRegistry {
  record(submission: ArtifactSubmission): Promise<StoredArtifact>;
  get(id: string): Promise<StoredArtifact | undefined>;
  find(filter?: ArtifactQuery): Promise<readonly StoredArtifact[]>;
  count(filter?: ArtifactQuery): Promise<number>;
}
```

`ArtifactKind = "bim" | "aim" | "cam"`. The **content-addressed id** is `sha256:<64-hex>`.

### Idempotent write

```ts
const stored = await registry.record({
  appId: "app.customer-onboarding",
  tenantId: "tenant.demo",
  artifactKind: "bim",
  version: "1.0.0",
  content: bimBody,
});
// second call with the same `content` returns the identical `stored`
```

### Query by `(appId, artifactKind, version)`

```ts
const cams = await registry.find({
  appId: "app.customer-onboarding",
  artifactKind: "cam",
  version: "1.0.0",
});
```

### Read-time integrity — fail-closed

`get()` and `find()` recompute the hash of every returned row and throw `ContentHashMismatchError` on drift. Application code cannot accidentally consume tampered bytes.

### Provenance chain verification

`verifyProvenanceChain(bim, aim, cam)` returns `{bimHash, aimHash, camHash}` and throws `ProvenanceChainMismatchError` if:

- `aim.sourceBim.contentHash` does not match `computeContentHash(bim)`
- `cam.metadata.sourceAim.contentHash` does not match `computeContentHash(aim)`

The placeholder `sha256:__pending__` is accepted (upstream not yet pinned).

## Storage backends

### In-memory

```ts
const registry = new InMemoryMetadataRegistry();
```

### JSONL (durable local / air-gapped)

```ts
const registry = new JsonlMetadataRegistry({
  filePath: "./data/metadata_artifacts.jsonl",
});
```

Each line is `{"id","insertedAt","record":{appId,tenantId,artifactKind,version,content}}`. Malformed lines are dropped and surfaced via `registry.loadWarnings()`.

### Postgres (production)

Install the DDL:

```powershell
psql -f node_modules/@appbana/metadata-registry/sql/metadata_artifacts.sql
```

`pg` is an **optional peer dependency**. Any duck-typed pool with `query(text, values)` works.

```ts
import { Pool } from "pg";
const registry = new PostgresMetadataRegistry({
  pool: new Pool({ connectionString: process.env["DATABASE_URL"] }),
});
```

### DDL notes

- `metadata_artifacts` is a single table with content-hash primary key.
- `artifact_kind` is `CHECK (artifact_kind IN ('bim', 'aim', 'cam'))`.
- RLS enabled with **INSERT + SELECT policies only**. No `UPDATE`/`DELETE` policies — the table is append-only. The driver honours this by never issuing UPDATE/DELETE.
- Indexes: `(app_id, artifact_kind, version, inserted_at DESC)`, `(tenant_id, inserted_at DESC)`, `(inserted_at DESC)`.
- Injection guard: `validateIdentifier(/^\w+$/)` on both `schema` and `table` config knobs.

## Testing

```powershell
npm test
```

38 tests across hash, integrity, in-memory, jsonl, postgres (pg-mem), and integration.

## Consumers

- `@appbana/platform-kernel` (Phase 1 WS-1.4) — resolves CAM by `(appId, "cam", version)` and verifies the chain before boot.
- `@appbana/governance-validator` — accepts artifact registry lookups for cross-reference checks.
- `@appbana/ai-application-agent` — records each round of BIM/AIM/CAM into the registry immediately after generation.
