# @appbana/validate-schemas

Round-trip validator for the canonical JSON Schemas in [`docs/schemas/`](../../docs/schemas/) against the reference example artifacts in [`examples/`](../../examples/).

Runs in CI as the `schema-validate` job. Add a new entry to [`schemas.manifest.json`](./schemas.manifest.json) whenever a new schema is published.

## Run locally

```powershell
# From repo root (requires pnpm install to have run):
pnpm validate:schemas

# Or directly, without pnpm:
node tools/validate-schemas/src/validate.mjs
```

The direct-node form requires `ajv` and `ajv-formats` to be resolvable — install them via `pnpm install` (workspace-local deps) or `npm install ajv ajv-formats` in this folder.

## Add a new schema

Edit [`schemas.manifest.json`](./schemas.manifest.json):

```jsonc
{
  "pairs": [
    {
      "name": "AIM v0.1 — Customer Onboarding",
      "schema": "docs/schemas/aim.v0.1.schema.json",
      "examples": ["examples/customer-onboarding/aim.json"]
    }
  ]
}
```
