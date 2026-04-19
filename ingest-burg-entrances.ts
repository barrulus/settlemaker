#!/usr/bin/env npx tsx
// ingest-burg-entrances.ts — Upsert settlemaker gate data into questables.
// Dev script, excluded from tsconfig (like tile-settlements.ts).
//
// Usage:
//   npx tsx ingest-burg-entrances.ts --burg-id 42
//   npx tsx ingest-burg-entrances.ts --all
//   npx tsx ingest-burg-entrances.ts --all --force
//   npx tsx ingest-burg-entrances.ts --burg-id 42 --dry-run
//
// Prereqs:
//   1. psql questables -f migrations/001_burg_entrances.sql
//   2. (optional) CREATE VIEW v_burg_route_bearings AS ... — if absent, gates
//      are placed without route bias and matched_route_id is always NULL.

import pg from 'pg';
import {
  generateFromBurg,
  type AzgaarBurgInput,
  type RoadBearingInput,
} from './src/index.js';
import type { Feature, FeatureCollection } from 'geojson';

// --- Arg parsing ---

const args = process.argv.slice(2);
const argVal = (name: string): string | null => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};
const argFlag = (name: string): boolean => args.includes(`--${name}`);

const BURG_ID = argVal('burg-id');
const WORLD_ID = argVal('world-id');
const ALL = argFlag('all');
const FORCE = argFlag('force');
const DRY_RUN = argFlag('dry-run');

if (!BURG_ID && !ALL) {
  console.error('Usage:');
  console.error('  npx tsx ingest-burg-entrances.ts --burg-id <N> [--world-id <UUID>] [--force] [--dry-run]');
  console.error('  npx tsx ingest-burg-entrances.ts --all [--world-id <UUID>] [--force] [--dry-run]');
  console.error('');
  console.error('  --world-id  Restrict to a single world (default: all worlds)');
  console.error('  --force     Bypass settlement_generation_version skip');
  console.error('  --dry-run   Print planned changes without writing to the DB');
  process.exit(1);
}

// --- DB ---

const pool = new pg.Pool({
  host: 'localhost',
  port: 5432,
  database: 'questables',
  user: 'barrulus',
});

interface BurgRow {
  world_id: string;
  burg_id: number;
  name: string;
  population: number;
  port: boolean;
  citadel: boolean;
  walls: boolean;
  plaza: boolean;
  temple: boolean;
  shanty: boolean;
  capital: boolean;
  culture: string | null;
  elevation: number | null;
  settlement_generation_version: string | null;
}

async function fetchBurgs(): Promise<BurgRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (BURG_ID) {
    params.push(Number(BURG_ID));
    where.push(`burg_id = $${params.length}`);
  }
  if (WORLD_ID) {
    params.push(WORLD_ID);
    where.push(`world_id = $${params.length}`);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await pool.query<BurgRow>(
    `SELECT world_id, burg_id, name, population, port, citadel, walls, plaza, temple,
            shanty, capital, culture, elevation, settlement_generation_version
     FROM maps_burgs
     ${clause}
     ORDER BY world_id, burg_id`,
    params,
  );
  return rows;
}

/**
 * Fetch route bearings + kinds for a burg from `v_burg_route_bearings`.
 * Absent view → empty array (gates get placed without route bias).
 * The view is questables-owned since it depends on `maps_routes` geometry.
 */
async function fetchRouteBearings(worldId: string, burgId: number): Promise<RoadBearingInput[]> {
  try {
    const { rows } = await pool.query<{
      route_id: string;
      bearing_deg: number;
      kind: 'road' | 'foot' | 'sea' | null;
    }>(
      `SELECT route_id, bearing_deg, kind
       FROM v_burg_route_bearings
       WHERE world_id = $1 AND burg_id = $2`,
      [worldId, burgId],
    );
    return rows.map(r => ({
      bearing_deg: r.bearing_deg,
      route_id: r.route_id,
      ...(r.kind ? { kind: r.kind } : {}),
    }));
  } catch {
    return [];
  }
}

function rowToBurg(row: BurgRow, bearings: RoadBearingInput[]): AzgaarBurgInput {
  return {
    name: row.name,
    population: row.population,
    port: row.port,
    citadel: row.citadel,
    walls: row.walls,
    plaza: row.plaza,
    temple: row.temple,
    shanty: row.shanty,
    capital: row.capital,
    ...(row.culture ? { culture: row.culture } : {}),
    ...(row.elevation != null ? { elevation: row.elevation } : {}),
    ...(bearings.length > 0 ? { roadBearings: bearings } : {}),
  };
}

function metadataOf(fc: FeatureCollection): {
  settlement_generation_version: string;
  generated_at: string;
} {
  const meta = (fc as unknown as { metadata: Record<string, string> }).metadata;
  return {
    settlement_generation_version: meta.settlement_generation_version,
    generated_at: meta.generated_at,
  };
}

function gatesOf(fc: FeatureCollection): Feature[] {
  return fc.features.filter(f => f.properties?.['layer'] === 'gate');
}

type Outcome = 'skipped' | 'upserted' | 'dry-run';

async function ingestBurg(row: BurgRow): Promise<{ outcome: Outcome; gateCount: number }> {
  const bearings = await fetchRouteBearings(row.world_id, row.burg_id);
  const burg = rowToBurg(row, bearings);

  const result = generateFromBurg(burg);
  const { settlement_generation_version, generated_at } = metadataOf(result.geojson);

  if (!FORCE && row.settlement_generation_version === settlement_generation_version) {
    return { outcome: 'skipped', gateCount: 0 };
  }

  const gates = gatesOf(result.geojson);

  if (DRY_RUN) {
    return { outcome: 'dry-run', gateCount: gates.length };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM maps_burg_entrances WHERE world_id = $1 AND burg_id = $2',
      [row.world_id, row.burg_id],
    );

    for (const g of gates) {
      const p = g.properties!;
      const coords = (g.geometry as unknown as { coordinates: [number, number] }).coordinates;
      await client.query(
        `INSERT INTO maps_burg_entrances
         (world_id, burg_id, gate_id, kind, sub_kind, wall_vertex_index, bearing_deg,
          local_x, local_y, matched_route_id, bearing_match_delta_deg,
          prev_gate_id, next_gate_id, settlement_generation_version, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          row.world_id,
          row.burg_id,
          p['gate_id'],
          p['kind'],
          p['sub_kind'],
          p['wall_vertex_index'],
          p['bearing_deg'],
          coords[0],
          coords[1],
          p['matched_route_id'] ?? null,
          p['bearing_match_delta_deg'] ?? null,
          p['prev_gate_id'] ?? null,
          p['next_gate_id'] ?? null,
          settlement_generation_version,
          generated_at,
        ],
      );
    }

    await client.query(
      'UPDATE maps_burgs SET settlement_generation_version = $1 WHERE world_id = $2 AND burg_id = $3',
      [settlement_generation_version, row.world_id, row.burg_id],
    );
    await client.query('COMMIT');
    return { outcome: 'upserted', gateCount: gates.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// --- Main ---

async function main() {
  const t0 = performance.now();
  const rows = await fetchBurgs();

  if (rows.length === 0) {
    console.error(BURG_ID ? `Burg ${BURG_ID} not found` : 'No burgs found');
    process.exit(1);
  }

  const flags = [FORCE ? 'forced' : null, DRY_RUN ? 'dry-run' : null].filter(Boolean).join(', ');
  console.log(`Processing ${rows.length} burg${rows.length > 1 ? 's' : ''}${flags ? ` (${flags})` : ''}`);

  const stats = { skipped: 0, upserted: 0, 'dry-run': 0, errors: 0 };
  let totalGates = 0;

  for (const row of rows) {
    try {
      const { outcome, gateCount } = await ingestBurg(row);
      stats[outcome]++;
      totalGates += gateCount;
      if (outcome !== 'skipped') {
        console.log(`  burg ${row.burg_id} (${row.name}): ${outcome} — ${gateCount} gate${gateCount === 1 ? '' : 's'}`);
      }
    } catch (e: unknown) {
      stats.errors++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  burg ${row.burg_id} (${row.name}): ERROR ${msg}`);
    }
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nDone: ${stats.upserted} upserted, ${stats.skipped} skipped, ${stats['dry-run']} dry-run, ` +
      `${stats.errors} errors — ${totalGates} gate rows — ${elapsed}s`,
  );

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
