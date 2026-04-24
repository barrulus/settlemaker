#!/usr/bin/env node
// tile-svg.mjs — Direct SVG → PNG tiles (no blur), parallel, Node/Windows friendly

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import yargs from 'yargs';
import pLimit from 'p-limit';

const argv = yargs(process.argv.slice(2))
  .option('source', { alias: 's', type: 'string', default: process.env.SOURCE_SVG || 'snoopia_states.svg', describe: 'Source SVG path' })
  .option('tileSize', { alias: 't', type: 'number', default: Number(process.env.TILE_SIZE) || 256, describe: 'Tile size in px' })
  .option('maxZoom', { alias: 'z', type: 'number', default: Number(process.env.MAX_ZOOM) || 14 })
  .option('startZoom', { alias: 'Z', type: 'number', default: Number(process.env.START_ZOOM) || 0 })
  .option('out', { alias: 'o', type: 'string', default: process.env.OUTPUT_DIR || 'tiles-states', describe: 'Output directory' })
  .option('world', { alias: 'w', type: 'string', default: process.env.WORLD_NAME })
  .option('meta', { alias: 'm', type: 'string', default: process.env.MAP_METADATA })
  .option('concurrency', { alias: 'c', type: 'number', default: Math.max(2, Math.min(os.cpus().length, 16)), describe: 'Parallel jobs' })
  .option('quiet', { type: 'boolean', default: false })
  .strict()
  .help()
  .argv;

// --- Load SVG & metadata ---
const SOURCE_SVG = path.resolve(argv.source);
if (!fs.existsSync(SOURCE_SVG)) {
  console.error(`Source SVG not found: ${SOURCE_SVG}`);
  process.exit(1);
}

const svgDir = path.dirname(SOURCE_SVG);
const svgBase = path.basename(SOURCE_SVG, '.svg');
let WORLD_NAME = argv.world;
if (!WORLD_NAME) {
  const m = svgBase.match(/^(.*)_[^_]+$/);
  WORLD_NAME = m ? m[1] : svgBase;
}

let MAP_METADATA = argv.meta || path.join(svgDir, `${WORLD_NAME}_mapinfo.json`);
if (!fs.existsSync(MAP_METADATA)) {
  const alt = path.join(svgDir, 'geoJSON', `${WORLD_NAME}_mapinfo.json`);
  if (fs.existsSync(alt)) MAP_METADATA = alt;
}
if (!fs.existsSync(MAP_METADATA)) {
  console.error(`Metadata not found. Checked:\n  ${path.join(svgDir, `${WORLD_NAME}_mapinfo.json`)}\n  ${path.join(svgDir, 'geoJSON', `${WORLD_NAME}_mapinfo.json`)}`);
  process.exit(1);
}

if (!argv.quiet) {
  console.log('Direct SVG tile rendering for OpenLayers (Node)');
  console.log(`Source: ${SOURCE_SVG}`);
  console.log(`Zoom levels: ${argv.startZoom} → ${argv.maxZoom}`);
  console.log(`Output: ${argv.out} | Concurrency: ${argv.concurrency}`);
}

const meta = JSON.parse(fs.readFileSync(MAP_METADATA, 'utf8'));
const WIDTH_PIXELS = Number(meta.width_pixels);
const HEIGHT_PIXELS = Number(meta.height_pixels);
const METERS_PER_PIXEL = Number(meta.meters_per_pixel);
const BOUND_WEST = Number(meta.bounds.west);
const BOUND_EAST = Number(meta.bounds.east);
const BOUND_NORTH = Number(meta.bounds.north);
const BOUND_SOUTH = Number(meta.bounds.south);

const MAP_WIDTH_METERS = BOUND_EAST - BOUND_WEST;
const MAP_HEIGHT_METERS = BOUND_NORTH - BOUND_SOUTH;

// --- Parse SVG once, get intrinsic size ---
const svgText = fs.readFileSync(SOURCE_SVG, 'utf8');

// light-weight viewBox/width/height extraction without full DOM cost
const svgTagMatch = svgText.match(/<svg[^>]*>/i);
if (!svgTagMatch) {
  console.error('Error: <svg> root tag not found.');
  process.exit(1);
}
const svgTag = svgTagMatch[0];

function attr(name) {
  const m = svgTag.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`, 'i'));
  return m ? m[1] : null;
}

let viewBox = attr('viewBox');
let SVG_WIDTH, SVG_HEIGHT;
if (viewBox) {
  const parts = viewBox.trim().split(/\s+/).map(Number);
  if (parts.length >= 4) {
    SVG_WIDTH = parts[2];
    SVG_HEIGHT = parts[3];
  }
}
if (!SVG_WIDTH || !SVG_HEIGHT) {
  // fall back to width/height attrs
  const w = attr('width');
  const h = attr('height');
  if (w && h) {
    SVG_WIDTH = Number(String(w).replace(/[^\d.]/g, ''));
    SVG_HEIGHT = Number(String(h).replace(/[^\d.]/g, ''));
  }
}
if (!SVG_WIDTH || !SVG_HEIGHT) {
  console.error('Error: could not determine SVG dimensions from viewBox/width/height.');
  process.exit(1);
}

// Ensure SVG matches metadata to avoid drift
if (Math.round(SVG_WIDTH) !== WIDTH_PIXELS || Math.round(SVG_HEIGHT) !== HEIGHT_PIXELS) {
  console.error(`Error: SVG dims (${SVG_WIDTH}x${SVG_HEIGHT}) ≠ metadata (${WIDTH_PIXELS}x${HEIGHT_PIXELS}).`);
  process.exit(1);
}

const META_ASPECT = WIDTH_PIXELS / HEIGHT_PIXELS;
if (!argv.quiet) {
  console.log(`World: ${WORLD_NAME}`);
  console.log(`Pixels: ${WIDTH_PIXELS}x${HEIGHT_PIXELS} | Extent (m): ${MAP_WIDTH_METERS.toFixed(2)} x ${Math.abs(MAP_HEIGHT_METERS).toFixed(2)} | Scale: ${METERS_PER_PIXEL} m/px`);
  console.log(`Aspect ratio: SVG=${(SVG_WIDTH/SVG_HEIGHT).toFixed(6)}, metadata=${META_ASPECT.toFixed(6)}`);
}

fs.mkdirSync(argv.out, { recursive: true });

// --- Helper: build cropped SVG string by overriding viewBox ---
function buildTileSvg(xPos, yPos, w, h) {
  // Replace or inject viewBox to crop; force width/height in px to TILE_SIZE.
  let out = svgText;

  if (/viewBox="/i.test(out)) {
    out = out.replace(/viewBox="[^"]+"/i, `viewBox="${xPos} ${yPos} ${w} ${h}"`);
  } else {
    out = out.replace(/<svg/i, `<svg viewBox="${xPos} ${yPos} ${w} ${h}"`);
  }

  if (/width="/i.test(out)) {
    out = out.replace(/width="[^"]+"/i, `width="${argv.tileSize}"`);
  } else {
    out = out.replace(/<svg/i, `<svg width="${argv.tileSize}"`);
  }

  if (/height="/i.test(out)) {
    out = out.replace(/height="[^"]+"/i, `height="${argv.tileSize}"`);
  } else {
    out = out.replace(/<svg/i, `<svg height="${argv.tileSize}"`);
  }

  // Ensure transparent background
  if (!/style="/i.test(out) || !/background/i.test(out)) {
    // not strictly needed; libvips produces transparent by default if no background
  }
  return out;
}

// --- Render one tile ---
async function renderTile(z, x, y) {
  const nTilesX = 2 ** z;
  const nTilesY = Math.max(1, Math.round(nTilesX / META_ASPECT));

  if (y >= nTilesY) {
    // transparent placeholder (0-byte file is fine; OL treats as empty)
    const outPath = path.join(argv.out, String(z), String(x), `${y}.png`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.alloc(0));
    return;
  }

  const tileW = SVG_WIDTH / nTilesX;
  const tileH = SVG_HEIGHT / nTilesY;
  const xPos = tileW * x;
  const yPos = tileH * y;

  const croppedSvg = buildTileSvg(xPos, yPos, tileW, tileH);
  const outPath = path.join(argv.out, String(z), String(x), `${y}.png`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Sharp will rasterize the SVG string at the requested output size
  await sharp(Buffer.from(croppedSvg))
    .png({ compressionLevel: 9 })
    .resize(argv.tileSize, argv.tileSize, { fit: 'fill' }) // already exact via viewBox; ensures output dims
    .toFile(outPath)
    .catch(async (e) => {
      // Produce a red error tile
      const errPng = await sharp({
        create: { width: argv.tileSize, height: argv.tileSize, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } }
      }).png().toBuffer();
      fs.writeFileSync(outPath, errPng);
      if (!argv.quiet) console.warn(`Warn: failed ${z}/${x}/${y}: ${e.message}`);
    });
}

// --- Parallel scheduler ---
sharp.concurrency(Math.max(1, argv.concurrency)); // libvips internal threads
const limit = pLimit(argv.concurrency);

for (let z = argv.startZoom; z <= argv.maxZoom; z++) {
  const nTilesX = 2 ** z;
  const nTilesY = Math.max(1, Math.round(nTilesX / META_ASPECT));
  if (!argv.quiet) console.log(`Rendering z=${z} (grid ${nTilesX}x${nTilesY})...`);

  const tasks = [];
  for (let x = 0; x < nTilesX; x++) {
    for (let y = 0; y < nTilesY; y++) {
      tasks.push(limit(() => renderTile(z, x, y)));
    }
  }
  await Promise.all(tasks);

  // per-zoom summary
  const zoomDir = path.join(argv.out, String(z));
  let count = 0;
  if (fs.existsSync(zoomDir)) {
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile() && p.endsWith('.png') && fs.statSync(p).size > 100) count++;
      }
    };
    walk(zoomDir);
  }
  if (!argv.quiet) console.log(`  Created ${count} non-empty tiles for z=${z}\n`);
}

// tileset.json + viewer.html
const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const tileset = {
  world: WORLD_NAME,
  generated_at: generatedAt,
  tile_size: argv.tileSize,
  min_zoom: argv.startZoom,
  max_zoom: argv.maxZoom,
  map: {
    width_pixels: WIDTH_PIXELS,
    height_pixels: HEIGHT_PIXELS,
    meters_per_pixel: METERS_PER_PIXEL,
    bounds: { west: BOUND_WEST, south: BOUND_SOUTH, east: BOUND_EAST, north: BOUND_NORTH },
    width_meters: MAP_WIDTH_METERS,
    height_meters: MAP_HEIGHT_METERS
  },
  source: { svg: SOURCE_SVG, metadata: MAP_METADATA }
};
fs.writeFileSync(path.join(argv.out, 'tileset.json'), JSON.stringify(tileset, null, 2));

const viewerHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Deep Zoom Map - No Blur!</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@v7.5.2/ol.css">
  <style>
    html, body, #map { margin:0; padding:0; width:100%; height:100%; }
    #info { position:absolute; top:10px; right:50px; background:rgba(255,255,255,0.95);
      padding:10px 15px; border-radius:5px; font-family:'Courier New', monospace; font-size:12px;
      box-shadow:0 2px 4px rgba(0,0,0,0.2); }
    .quality { font-weight:bold; color:#4CAF50; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/ol@v7.5.2/dist/ol.js"></script>
</head>
<body>
  <div id="map"></div>
  <div id="info">
    <div>Zoom: <span id="zoom">2</span> / ${argv.maxZoom}</div>
    <div>Quality: <span class="quality">PERFECT</span></div>
    <div>Each tile rendered from SVG</div>
  </div>
  <script>
    const map = new ol.Map({
      target: 'map',
      layers: [ new ol.layer.Tile({ source: new ol.source.XYZ({
        url: '${argv.out}/{z}/{x}/{y}.png', minZoom: ${argv.startZoom}, maxZoom: ${argv.maxZoom}, tilePixelRatio: 1
      })}) ],
      view: new ol.View({ center:[0,0], zoom:2, minZoom:${argv.startZoom}, maxZoom:${argv.maxZoom} })
    });
    map.getView().on('change:resolution', () => {
      document.getElementById('zoom').textContent = map.getView().getZoom().toFixed(1);
    });
  </script>
</body>
</html>`;
fs.writeFileSync('viewer.html', viewerHtml, 'utf8');

// summary
function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b/1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b/1024**2).toFixed(1)} MB`;
  return `${(b/1024**3).toFixed(1)} GB`;
}
let totalBytes = 0, totalPng = 0;
const walkAll = (dir) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkAll(p);
    else if (ent.isFile() && p.endsWith('.png')) { totalPng++; totalBytes += fs.statSync(p).size; }
  }
};
walkAll(argv.out);
console.log('=== Rendering Complete ===');
console.log(`Total tiles: ${totalPng}`);
console.log(`Total size: ${formatBytes(totalBytes)}`);
console.log('\nView your map: open viewer.html\n');
