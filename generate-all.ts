import pg from 'pg';
import { mkdirSync, writeFileSync } from 'fs';
import { generateFromBurg, type AzgaarBurgInput } from './src/index.js';

const pool = new pg.Pool({
  host: 'localhost',
  port: 5432,
  database: 'questables',
  user: 'barrulus',
});

/** Fetch road bearings for all burgs in one batch query.
 *  - Walled burgs: royal, regional, market routes only
 *  - Unwalled burgs: all land routes including footpath and local
 *  - 45-degree sector dedup, prioritised by route importance
 */
async function fetchAllBearings(worldId: string): Promise<Map<number, number[]>> {
  const { rows } = await pool.query<{ burg_id: number; bearing: number }>(`
    WITH crossings AS (
      SELECT
        b.burg_id,
        b.walls,
        rt.type,
        degrees(ST_Azimuth(b.geom, crossing_pt.geom)) as bearing
      FROM maps_burgs b
      JOIN maps_routes rt ON rt.world_id = b.world_id
        AND ST_DWithin(b.geom, rt.geom, 50000)
        AND rt.type != 'majorSea'
      CROSS JOIN LATERAL (
        SELECT (ST_DumpPoints(
          ST_Intersection(rt.geom, ST_ExteriorRing(ST_Buffer(b.geom, 10000)))
        )).geom
      ) crossing_pt(geom)
      WHERE b.world_id = $1
    ),
    ranked AS (
      SELECT
        burg_id,
        bearing,
        floor(bearing / 45) as bucket,
        CASE
          WHEN NOT walls AND type IN ('footpath', 'local') THEN true
          WHEN type IN ('royal', 'regional', 'market') THEN true
          ELSE false
        END as include,
        CASE type
          WHEN 'royal' THEN 1
          WHEN 'regional' THEN 2
          WHEN 'market' THEN 3
          WHEN 'local' THEN 4
          WHEN 'footpath' THEN 5
        END as type_rank
      FROM crossings
    ),
    deduped AS (
      SELECT DISTINCT ON (burg_id, bucket)
        burg_id, bearing
      FROM ranked
      WHERE include
      ORDER BY burg_id, bucket, type_rank, bearing
    )
    SELECT burg_id, bearing FROM deduped ORDER BY burg_id, bearing
  `, [worldId]);

  const result = new Map<number, number[]>();
  for (const row of rows) {
    let bearings = result.get(row.burg_id);
    if (!bearings) {
      bearings = [];
      result.set(row.burg_id, bearings);
    }
    bearings.push(row.bearing);
  }
  return result;
}

async function main() {
  const startTime = performance.now();

  mkdirSync('output', { recursive: true });

  const { rows } = await pool.query<{
    burg_id: number;
    world_id: string;
    name: string;
    population: number;
    port: boolean;
    citadel: boolean;
    walls: boolean;
    plaza: boolean;
    temple: boolean;
    shanty: boolean;
    capital: boolean;
    culture: string;
    elevation: number;
  }>(`
    SELECT burg_id, world_id, name, population, port, citadel, walls, plaza, temple, shanty, capital, culture, elevation
    FROM maps_burgs
    ORDER BY population DESC
  `);

  console.log(`Found ${rows.length} burgs`);

  // Get world_id (assuming single world)
  const worldId = rows[0]?.world_id;
  let bearingsMap = new Map<number, number[]>();
  if (worldId) {
    console.log('Fetching road bearings...');
    bearingsMap = await fetchAllBearings(worldId);
    console.log(`Got bearings for ${bearingsMap.size} burgs\n`);
  }

  let successes = 0;
  let failures = 0;

  for (const row of rows) {
    const roadBearings = bearingsMap.get(row.burg_id);
    const burg: AzgaarBurgInput = {
      name: row.name,
      population: row.population,
      port: row.port,
      citadel: row.citadel,
      walls: row.walls,
      plaza: row.plaza,
      temple: row.temple,
      shanty: row.shanty,
      capital: row.capital,
      culture: row.culture,
      elevation: row.elevation,
      roadBearings,
    };

    const t0 = performance.now();
    try {
      const result = generateFromBurg(burg);
      const elapsed = (performance.now() - t0).toFixed(0);
      const nGates = result.model.border?.gates.length ?? 0;
      const filename = `${burg.name}-${row.burg_id}.svg`;
      writeFileSync(`output/${filename}`, result.svg);
      const bearingStr = roadBearings
        ? `bearings=[${roadBearings.map(b => b.toFixed(0)).join(',')}]`
        : 'no bearings';
      console.log(`  ${burg.name} (pop=${burg.population}, gates=${nGates}, ${bearingStr}) — ${elapsed}ms`);
      successes++;
    } catch (err) {
      const elapsed = (performance.now() - t0).toFixed(0);
      console.error(`  FAIL ${burg.name} (pop=${burg.population}) — ${elapsed}ms: ${err}`);
      failures++;
    }
  }

  const totalTime = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone: ${successes} succeeded, ${failures} failed, ${rows.length} total — ${totalTime}s`);

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
