#!/usr/bin/env npx tsx
// tile-settlements.ts — CLI to tile settlement SVGs into z/x/y PNG pyramids.
// Dev script, excluded from tsconfig (like generate-all.ts).
//
// Usage:
//   npx tsx tile-settlements.ts --burg-id 42 --viewer
//   npx tsx tile-settlements.ts --all --quiet

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import sharp from 'sharp';
import pLimit from 'p-limit';
import {
  generateFromBurg,
  parseSvgViewBox,
  computeTileInfo,
  cropSvgToTile,
  enumerateTiles,
  totalTileCount,
  computeSettlementScale,
  type AzgaarBurgInput,
  type TileInfo,
} from './src/index.js';

// --- Arg parsing (hand-rolled, consistent with existing scripts) ---

const args = process.argv.slice(2);

function argVal(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

function argFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const BURG_ID = argVal('burg-id', '');
const ALL = argFlag('all');
const OUT_DIR = argVal('out', 'tiles');
const TILE_SIZE = Number(argVal('tile-size', '256'));
const CONCURRENCY = Number(argVal('concurrency', String(Math.max(2, Math.min(os.cpus().length, 16)))));
const VIEWER = argFlag('viewer');
const QUIET = argFlag('quiet');

if (!BURG_ID && !ALL) {
  console.error('Usage: npx tsx tile-settlements.ts --burg-id <N> [--viewer]');
  console.error('       npx tsx tile-settlements.ts --all [--quiet]');
  console.error('');
  console.error('Options:');
  console.error('  --burg-id <N>      Generate tiles for a specific burg');
  console.error('  --all              Generate tiles for all burgs');
  console.error('  --out <dir>        Output directory (default: tiles)');
  console.error('  --tile-size <N>    Tile size in pixels (default: 256)');
  console.error('  --concurrency <N>  Parallel tile renders (default: CPU count)');
  console.error('  --viewer           Write viewer.html per burg');
  console.error('  --quiet            Suppress per-tile output');
  process.exit(1);
}

// --- DB connection ---

const pool = new pg.Pool({
  host: 'localhost',
  port: 5432,
  database: 'questables',
  user: 'barrulus',
});

interface BurgRow {
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
  culture: string;
  elevation: number;
}

async function fetchBurgs(): Promise<BurgRow[]> {
  const query = `
    SELECT burg_id, name, population, port, citadel, walls, plaza, temple, shanty, capital, culture, elevation
    FROM maps_burgs
    ${BURG_ID ? 'WHERE burg_id = $1' : ''}
    ORDER BY population DESC
  `;
  const params = BURG_ID ? [Number(BURG_ID)] : [];
  const { rows } = await pool.query<BurgRow>(query, params);
  return rows;
}

function rowToBurg(row: BurgRow): AzgaarBurgInput {
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
    culture: row.culture,
    elevation: row.elevation,
  };
}

// --- Tile rendering ---

async function renderTile(
  svgString: string,
  tileInfo: TileInfo,
  z: number,
  x: number,
  y: number,
  outPath: string,
): Promise<void> {
  const croppedSvg = cropSvgToTile(svgString, tileInfo, z, x, y, TILE_SIZE);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  try {
    await sharp(Buffer.from(croppedSvg))
      .png({ compressionLevel: 9 })
      .resize(TILE_SIZE, TILE_SIZE, { fit: 'fill' })
      .toFile(outPath);
  } catch (e: unknown) {
    // Write a red error tile
    const errPng = await sharp({
      create: { width: TILE_SIZE, height: TILE_SIZE, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
    }).png().toBuffer();
    fs.writeFileSync(outPath, errPng);
    if (!QUIET) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  Warn: failed ${z}/${x}/${y}: ${msg}`);
    }
  }
}

function writeTilesetJson(burgDir: string, row: BurgRow, tileInfo: TileInfo): void {
  const scale = computeSettlementScale(row.population);
  const tilesAtMaxZoom = Math.pow(2, tileInfo.maxZoom);
  const metersPerPixelAtMaxZoom = (tileInfo.squareViewBox.width * tileInfo.metersPerUnit) / (tilesAtMaxZoom * TILE_SIZE);

  const tileset = {
    version: 1,
    burg: { id: row.burg_id, name: row.name, population: row.population },
    tiles: { tileSize: TILE_SIZE, minZoom: 0, maxZoom: tileInfo.maxZoom, format: 'png' },
    scale: {
      diameterMeters: Math.round(scale.diameterMeters * 10) / 10,
      metersPerUnit: Math.round(tileInfo.metersPerUnit * 100) / 100,
      metersPerPixelAtMaxZoom: Math.round(metersPerPixelAtMaxZoom * 1000) / 1000,
    },
    extent: {
      squareViewBox: tileInfo.squareViewBox,
      originalViewBox: tileInfo.originalViewBox,
    },
  };

  fs.writeFileSync(path.join(burgDir, 'tileset.json'), JSON.stringify(tileset, null, 2));
}

function writeViewerHtml(burgDir: string, row: BurgRow, tileInfo: TileInfo): void {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Settlement Tiles - ${row.name}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@v7.5.2/ol.css">
  <style>
    html, body, #map { margin:0; padding:0; width:100%; height:100%; }
    #info { position:absolute; top:10px; right:50px; background:rgba(255,255,255,0.95);
      padding:10px 15px; border-radius:5px; font-family:'Courier New', monospace; font-size:12px;
      box-shadow:0 2px 4px rgba(0,0,0,0.2); }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/ol@v7.5.2/dist/ol.js"><\/script>
</head>
<body>
  <div id="map"></div>
  <div id="info">
    <div><b>${row.name}</b> (pop ${row.population.toLocaleString()})</div>
    <div>Zoom: <span id="zoom">0</span> / ${tileInfo.maxZoom}</div>
    <div>Tiles: ${totalTileCount(tileInfo.maxZoom)}</div>
  </div>
  <script>
    const maxZoom = ${tileInfo.maxZoom};
    const extent = [0, 0, 256, 256];
    const projection = new ol.proj.Projection({ code: 'settlement', units: 'pixels', extent: extent });
    const map = new ol.Map({
      target: 'map',
      layers: [ new ol.layer.Tile({ source: new ol.source.XYZ({
        url: '{z}/{x}/{y}.png',
        minZoom: 0,
        maxZoom: maxZoom,
        tileSize: ${TILE_SIZE},
        projection: projection
      })}) ],
      view: new ol.View({
        projection: projection,
        center: ol.extent.getCenter(extent),
        zoom: 1,
        minZoom: 0,
        maxZoom: maxZoom
      })
    });
    map.getView().on('change:resolution', function() {
      document.getElementById('zoom').textContent = map.getView().getZoom().toFixed(1);
    });
  <\/script>
</body>
</html>`;
  fs.writeFileSync(path.join(burgDir, 'viewer.html'), html);
}

// --- Main ---

async function processBurg(row: BurgRow): Promise<{ tiles: number; errors: number }> {
  const t0 = performance.now();
  const burg = rowToBurg(row);

  // 1. Generate SVG
  const result = generateFromBurg(burg);
  const svg = result.svg;

  // 2. Parse viewBox and compute tile info
  const viewBox = parseSvgViewBox(svg);
  if (!viewBox) {
    console.error(`  SKIP ${row.name} (burg ${row.burg_id}): no viewBox in SVG`);
    return { tiles: 0, errors: 1 };
  }
  const tileInfo = computeTileInfo(viewBox, row.population);

  // 3. Set up output directory
  const burgDir = path.join(OUT_DIR, String(row.burg_id));
  fs.mkdirSync(burgDir, { recursive: true });

  // 4. Render all tiles
  const tiles = enumerateTiles(tileInfo.maxZoom);
  const total = tiles.length;
  const limit = pLimit(CONCURRENCY);
  sharp.concurrency(Math.max(1, CONCURRENCY));

  let rendered = 0;
  let errors = 0;

  await Promise.all(
    tiles.map(({ z, x, y }) =>
      limit(async () => {
        const outPath = path.join(burgDir, String(z), String(x), `${y}.png`);
        try {
          await renderTile(svg, tileInfo, z, x, y, outPath);
          rendered++;
        } catch {
          errors++;
        }
        if (!QUIET && rendered % 50 === 0) {
          process.stdout.write(`\r  ${row.name}: ${rendered}/${total} tiles`);
        }
      }),
    ),
  );

  // 5. Write tileset.json
  writeTilesetJson(burgDir, row, tileInfo);

  // 6. Optionally write viewer
  if (VIEWER) {
    writeViewerHtml(burgDir, row, tileInfo);
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  if (!QUIET) {
    console.log(`\r  ${row.name} (pop=${row.population}, zoom=0-${tileInfo.maxZoom}, ${total} tiles) — ${elapsed}s`);
  }

  return { tiles: rendered, errors };
}

async function main() {
  const startTime = performance.now();

  const rows = await fetchBurgs();
  if (rows.length === 0) {
    console.error(BURG_ID ? `Burg ${BURG_ID} not found` : 'No burgs found');
    process.exit(1);
  }

  console.log(`Processing ${rows.length} burg${rows.length > 1 ? 's' : ''} → ${OUT_DIR}/`);
  console.log(`Tile size: ${TILE_SIZE}px | Concurrency: ${CONCURRENCY}`);

  let totalTiles = 0;
  let totalErrors = 0;

  for (const row of rows) {
    const { tiles, errors } = await processBurg(row);
    totalTiles += tiles;
    totalErrors += errors;
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone: ${rows.length} burgs, ${totalTiles} tiles, ${totalErrors} errors — ${elapsed}s`);

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
