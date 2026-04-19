-- settlemaker P0 — gate-output ingestion schema
--
-- Apply with:
--   psql questables -f migrations/001_burg_entrances.sql
--
-- Idempotent: safe to re-run.

BEGIN;

-- Version marker so the ingester can skip burgs whose inputs haven't changed.
-- Stable content hash emitted by settlemaker v0.2.0+ at
-- geojson.metadata.settlement_generation_version.
ALTER TABLE maps_burgs
  ADD COLUMN IF NOT EXISTS settlement_generation_version TEXT;

-- One row per gate per burg. Keyed on (world_id, burg_id) to match the natural
-- addressing of maps_burgs — burg_id alone is only unique within a world.
CREATE TABLE IF NOT EXISTS maps_burg_entrances (
  world_id                        UUID        NOT NULL,
  burg_id                         INTEGER     NOT NULL,
  gate_id                         TEXT        NOT NULL,
  kind                            TEXT        NOT NULL CHECK (kind IN ('land', 'harbour')),
  sub_kind                        TEXT        NOT NULL CHECK (sub_kind IN ('road', 'foot', 'harbour')),
  wall_vertex_index               INTEGER     NOT NULL,
  bearing_deg                     REAL        NOT NULL,
  local_x                         REAL        NOT NULL,
  local_y                         REAL        NOT NULL,
  matched_route_id                TEXT,
  bearing_match_delta_deg         REAL,
  prev_gate_id                    TEXT,
  next_gate_id                    TEXT,
  settlement_generation_version   TEXT        NOT NULL,
  generated_at                    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (world_id, burg_id, gate_id),
  FOREIGN KEY (world_id, burg_id) REFERENCES maps_burgs(world_id, burg_id) ON DELETE CASCADE
);

-- Gate-picker lookup: "which gate does route X enter through for burg Y?"
CREATE INDEX IF NOT EXISTS idx_burg_entrances_matched_route
  ON maps_burg_entrances (world_id, burg_id, matched_route_id)
  WHERE matched_route_id IS NOT NULL;

COMMIT;
