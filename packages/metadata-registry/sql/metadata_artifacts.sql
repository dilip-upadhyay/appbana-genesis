-- @appbana/metadata-registry — Postgres DDL v0.1
--
-- Append-only content-addressed store for the BIM / AIM / CAM artifact
-- triple. Every row is keyed by sha-256 of the canonicalised body. The table
-- is APPEND-ONLY: no UPDATE, no DELETE. Enforced by:
--   1. Application-level (MetadataRegistry interface exposes only `record`).
--   2. RLS policy below (only SELECT + INSERT for the app role).
--   3. Governance policy: retention lifetime >= any referencing pointer or
--      GateReport.

CREATE SCHEMA IF NOT EXISTS appbana;

CREATE TABLE IF NOT EXISTS appbana.metadata_artifacts (
    -- Content-addressed id = sha256:<hex> of the canonicalised body.
    id             TEXT        PRIMARY KEY,
    -- When the row landed. Distinct from any timestamps INSIDE `content`.
    inserted_at    TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),

    -- Denormalised columns for `(appId, artifactKind, version)` queries.
    -- Source of truth is `content`, but these mirror-columns exist so the
    -- common query path never has to deserialise the full body.
    app_id         TEXT        NOT NULL,
    tenant_id      TEXT        NOT NULL,
    artifact_kind  TEXT        NOT NULL CHECK (artifact_kind IN ('bim', 'aim', 'cam')),
    version        TEXT        NOT NULL,

    -- Full canonicalised artifact body. Every read recomputes sha-256 over
    -- these bytes and compares to `id`, so tampering is detected at read time.
    content        JSONB       NOT NULL,

    CONSTRAINT metadata_artifacts_id_prefix CHECK (id LIKE 'sha256:%')
);

CREATE INDEX IF NOT EXISTS metadata_artifacts_app_kind_ver_idx
    ON appbana.metadata_artifacts (app_id, artifact_kind, version, inserted_at DESC);

CREATE INDEX IF NOT EXISTS metadata_artifacts_tenant_id_idx
    ON appbana.metadata_artifacts (tenant_id, inserted_at DESC);

CREATE INDEX IF NOT EXISTS metadata_artifacts_inserted_at_idx
    ON appbana.metadata_artifacts (inserted_at DESC);

-- Row-Level Security — application role gets SELECT + INSERT only.
ALTER TABLE appbana.metadata_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS metadata_artifacts_insert ON appbana.metadata_artifacts;
CREATE POLICY metadata_artifacts_insert ON appbana.metadata_artifacts
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS metadata_artifacts_select ON appbana.metadata_artifacts;
CREATE POLICY metadata_artifacts_select ON appbana.metadata_artifacts
    FOR SELECT
    USING (true);

-- No UPDATE or DELETE policies == UPDATE and DELETE denied for policy-restricted roles.
