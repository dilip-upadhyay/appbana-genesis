-- @appbana/ai-provenance-store — Postgres DDL v0.1
--
-- Ships now so ops can pre-provision the ai_provenance table; the Postgres
-- driver implementation is a v0.2 follow-up (blocked on the `pg` peer-dep
-- decision). The in-memory + JSONL backends are functionally complete.
--
-- CRITICAL: This table is APPEND-ONLY. No UPDATE, no DELETE.
-- Enforced by:
--   1. Application-level (AIProvenanceStore interface exposes only `record`).
--   2. RLS policy below (only SELECT + INSERT permitted for the app role).
--   3. Governance policy: retention lifetime >= any referencing pointer/artifact.

CREATE SCHEMA IF NOT EXISTS appbana;

CREATE TABLE IF NOT EXISTS appbana.ai_provenance (
    -- Content-addressed id = sha256:<hex> of the canonicalized record.
    id                        TEXT        PRIMARY KEY,
    -- When the row landed. Distinct from record.requestedAt / record.completedAt.
    inserted_at               TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),

    -- Denormalized columns for common query paths. All source-of-truth values
    -- live inside `record` — these mirror-columns exist purely for indexes.
    ai_provenance_version     TEXT        NOT NULL,
    model_binding             TEXT        NOT NULL,
    model_name                TEXT        NOT NULL,
    model_version             TEXT        NOT NULL,
    prompt_template_ref       TEXT        NOT NULL,
    prompt_template_version   TEXT        NOT NULL,
    prompt_template_hash      TEXT        NOT NULL,
    input_hash                TEXT        NOT NULL,
    output_hash               TEXT        NOT NULL,
    requesting_agent          TEXT        NOT NULL,
    requested_at              TIMESTAMPTZ NOT NULL,
    completed_at              TIMESTAMPTZ NOT NULL,
    wall_clock_ms             INTEGER     NOT NULL CHECK (wall_clock_ms >= 0),
    token_input               INTEGER     NOT NULL CHECK (token_input >= 0),
    token_output              INTEGER     NOT NULL CHECK (token_output >= 0),
    token_total               INTEGER     NOT NULL CHECK (token_total >= 0),

    -- Full canonical record. All queries by novel filters use this + jsonb ops.
    record                    JSONB       NOT NULL,

    -- Structural sanity — the row's denormalized columns MUST match the record.
    CONSTRAINT ai_provenance_version_matches CHECK (
        record ->> 'aiProvenanceVersion' = ai_provenance_version
    ),
    CONSTRAINT ai_provenance_hash_prefix CHECK (id LIKE 'sha256:%')
);

CREATE INDEX IF NOT EXISTS ai_provenance_inserted_at_idx
    ON appbana.ai_provenance (inserted_at DESC);

CREATE INDEX IF NOT EXISTS ai_provenance_requesting_agent_idx
    ON appbana.ai_provenance (requesting_agent, inserted_at DESC);

CREATE INDEX IF NOT EXISTS ai_provenance_model_binding_idx
    ON appbana.ai_provenance (model_binding, inserted_at DESC);

-- Feeds `prompt-registry-check --provenance-refs`.
CREATE INDEX IF NOT EXISTS ai_provenance_prompt_ref_idx
    ON appbana.ai_provenance (prompt_template_ref, prompt_template_version);

-- Optional GIN for ad-hoc queries into the JSON body.
CREATE INDEX IF NOT EXISTS ai_provenance_record_gin_idx
    ON appbana.ai_provenance USING GIN (record jsonb_path_ops);

-- Row-Level Security — application role gets SELECT + INSERT only.
ALTER TABLE appbana.ai_provenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_provenance_insert ON appbana.ai_provenance;
CREATE POLICY ai_provenance_insert ON appbana.ai_provenance
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS ai_provenance_select ON appbana.ai_provenance;
CREATE POLICY ai_provenance_select ON appbana.ai_provenance
    FOR SELECT
    USING (true);

-- No UPDATE or DELETE policies == UPDATE and DELETE denied for policy-restricted roles.

-- Convenience view for the prompt-registry-check CLI.
CREATE OR REPLACE VIEW appbana.ai_provenance_prompt_refs AS
    SELECT DISTINCT
        prompt_template_ref     AS ref,
        prompt_template_version AS version,
        prompt_template_hash    AS "templateHash"
    FROM appbana.ai_provenance
    ORDER BY ref, version;
