import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateSettlement } from '../src/index.js';
import { roadCrossSection } from '../src/village/cross-section.js';
import { angularGap, arcLengths, bearingOf, dist, polylineLength, sampleAt } from '../src/village/geometry.js';
import { renderVillage } from '../src/village/render.js';
import { blockAreas } from '../src/village/skeleton/blocks.js';
import { isLandmarkLot } from '../src/village/skeleton/landmarks.js';
import { networkComponents, roadNetwork } from '../src/village/skeleton/network.js';
import { isTrunk } from '../src/village/skeleton/trunks.js';
import { isApron, type VillageModel } from '../src/village/types.js';
import { roadReviewFixtures } from '../tests/fixtures/village-roads.js';

const args = process.argv.slice(2);
const value = (key: string, fallback: string) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const out = resolve(value('--out', 'output/road-review/current'));
const baseline = resolve(value('--baseline', 'output/road-review/baseline'));
const heldOut = args.includes('--held-out');
mkdirSync(out, { recursive: true });
const rows: Record<string, unknown>[] = [];
const cards: string[] = [];
const escape = (s: unknown) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const revision = process.env.ROAD_REVIEW_SOURCE_REVISION || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = !process.env.ROAD_REVIEW_SOURCE_REVISION && execFileSync('git', ['diff', '--', 'src'], { encoding: 'utf8' }).length > 0;
const baselineRows = existsSync(join(baseline, 'metrics.json'))
  ? JSON.parse(readFileSync(join(baseline, 'metrics.json'), 'utf8')).rows as Array<{ id: string; seed: number; input: unknown; }> : [];
function metrics(m: VillageModel) {
  const internal = m.lanes.filter(l => !isTrunk(l.id));
  const dwellings = m.buildings.filter(b => !isLandmarkLot(b.lotId)).length;
  const assigned = new Set(m.buildings.map(b => m.lots.find(l => l.id === b.lotId)?.laneId));
  const graph = roadNetwork(m.lanes, m.green, m.buildings, m.lots);
  const components = networkComponents(graph);
  const homeComponent = components.get('green');
  const frontage = m.lots.filter(l => internal.some(r => r.id === l.laneId) && m.buildings.some(b => b.lotId === l.id))
    .reduce((sum, l) => sum + l.frontageM, 0);
  const length = internal.reduce((s, l) => s + polylineLength(l.points), 0);
  let maxTurn = 0, sharp = 0, minRadius = Infinity;
  for (const lane of internal) {
    const acc = arcLengths(lane.points), total = acc.at(-1)!;
    // Fixed physical windows: adding vertices cannot conceal a corner.
    for (let s = 4; s <= total - 4; s += 2) {
      const a = sampleAt(lane.points, acc, s - 4).p;
      const b = sampleAt(lane.points, acc, s).p;
      const c = sampleAt(lane.points, acc, s + 4).p;
      if (dist(a, b) < 0.01 || dist(b, c) < 0.01) continue;
      const turn = angularGap(bearingOf(a, b), bearingOf(b, c));
      maxTurn = Math.max(maxTurn, turn); if (turn > 60) sharp++;
      const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (cross > 1e-6) minRadius = Math.min(minRadius, dist(a, b) * dist(b, c) * dist(a, c) / (2 * cross));
    }
  }
  return {
    waterPolygons: m.site.water.length, greenShape: m.green.shape,
    landmarkFrontage: m.buildings.filter(b => isLandmarkLot(b.lotId)).map(b => ({ id: b.lotId, distanceToGreenM: dist(b.position, m.green.centre) })),
    buildings: m.buildings.length, ordinaryDwellings: dwellings,
    metresPerDwelling: length / Math.max(1, dwellings),
    internalSurfaceRangeM: internal.length ? [Math.min(...internal.map(l => roadCrossSection(l).surfaceM)), Math.max(...internal.map(l => roadCrossSection(l).surfaceM))] : null,
    housed: m.buildings.reduce((s, b) => s + b.occupancy, 0),
    components: new Set(components.values()).size,
    accessFailures: m.buildings.filter(b => !graph.buildings.has(b.id) || components.get(graph.buildings.get(b.id)!) !== homeComponent).length,
    occupiedFrontageShare: frontage / Math.max(1, 2 * length),
    internalLanes: internal.length, internalMetres: length, metresPerBuilding: length / Math.max(1, m.buildings.length),
    requiredMetres: m.lanes.filter(l => isTrunk(l.id)).reduce((s, l) => s + polylineLength(l.points), 0),
    emptyMetres: internal.filter(l => !assigned.has(l.id)).reduce((s, l) => s + polylineLength(l.points), 0),
    blocks: blockAreas(m.lanes.filter(l => !isApron(l.id)), m.green).length,
    maxTurn, sharpWindows: sharp, minBendRadius: Number.isFinite(minRadius) ? minRadius : null,
    diagnostics: m.diagnostics
  };
}
for (const f of roadReviewFixtures) {
  const seed = heldOut ? f.seed + 100 : f.seed;
  const start = performance.now();
  const result = generateSettlement(f.input, { seed });
  const runtimeMs = performance.now() - start;
  const matchedBaseline = baseline !== out && baselineRows.some(b => b.id === f.id && b.seed === seed && JSON.stringify(b.input) === JSON.stringify(f.input));
  let detail = result.svg;
  let measures: Record<string, unknown> = {};
  if (result.kind === 'village') {
    const m = result.model;
    measures = metrics(m);
    writeFileSync(join(out, `${f.id}.model.json`), JSON.stringify(m));
    const points = [m.green.centre, ...m.buildings.map(b => b.position), ...m.lanes.filter(l => !isTrunk(l.id)).flatMap(l => l.points)];
    const ownFrame = {
      minX: Math.min(...points.map(p => p.x)) - 15, maxX: Math.max(...points.map(p => p.x)) + 15,
      minY: Math.min(...points.map(p => p.y)) - 15, maxY: Math.max(...points.map(p => p.y)) + 15
    };
    // Union with baseline gives a matched scale in each before/after pair.
    const frameFile = join(baseline, `${f.id}.frame.json`);
    const before = matchedBaseline && existsSync(frameFile) ? JSON.parse(readFileSync(frameFile, 'utf8')) : ownFrame;
    const frame = {
      minX: Math.min(before.minX, ownFrame.minX), minY: Math.min(before.minY, ownFrame.minY),
      maxX: Math.max(before.maxX, ownFrame.maxX), maxY: Math.max(before.maxY, ownFrame.maxY)
    };
    writeFileSync(join(out, `${f.id}.frame.json`), JSON.stringify(ownFrame));
    detail = renderVillage({ ...m, frame }, 4);
    const scale = `<g><path d="M20 30h80" stroke="black" stroke-width="2"/><text x="20" y="22" font-size="14">20 m</text></g>`;
    detail = detail.replace('</svg>', `${scale}</svg>`);
    // Standalone overlay toggle works inside each embedded SVG.
    detail = detail.replace('<svg ', '<svg onclick="this.classList.toggle(\'roads\')" ')
      .replace('</svg>', '<style>.roads [data-band]:not([data-band="route"]){opacity:0.12}</style></svg>');
    const oldModel = join(baseline, `${f.id}.model.json`);
    if (matchedBaseline && existsSync(oldModel)) {
      const old = JSON.parse(readFileSync(oldModel, 'utf8')) as VillageModel;
      // Crop the original renderer's output, preserving historical paint and
      // geometry exactly. Both panels span the same world-space rectangle.
      const x = (frame.minX - old.frame.minX) * 4, y = (frame.minY - old.frame.minY) * 4;
      const width = (frame.maxX - frame.minX) * 4, height = (frame.maxY - frame.minY) * 4;
      const oldSvg = readFileSync(join(baseline, `${f.id}.svg`), 'utf8')
        .replace(/viewBox="[^"]*"/, `viewBox="${x} ${y} ${width} ${height}"`)
        .replace(/width="[^"]*"/, `width="${width}"`).replace(/height="[^"]*"/, `height="${height}"`)
        .replace('</svg>', `<g transform="translate(${x} ${y})">${scale}</g></svg>`);
      writeFileSync(join(out, `${f.id}.before.svg`), oldSvg);
    }
  }
  writeFileSync(join(out, `${f.id}.svg`), result.svg);
  writeFileSync(join(out, `${f.id}.detail.svg`), detail);
  rows.push({ id: f.id, seed, input: f.input, kind: result.kind, runtimeMs, ...measures });
  const hasBefore = matchedBaseline && existsSync(join(out, `${f.id}.before.svg`));
  cards.push(`<article><h2>${escape(f.id)} · pop ${f.input.population} · seed ${seed}</h2><p>${escape(JSON.stringify(measures))}</p><div class="pair">${hasBefore ? `<object data="${f.id}.before.svg"></object>` : ''}<object data="${f.id}.detail.svg"></object></div><a href="${f.id}.svg">Whole settlement</a>${measures.waterPolygons ? `<h3>Landscape overview — coastline and water</h3><object class="landscape" data="${f.id}.svg"></object>` : ''}</article>`);
  console.log(`${f.id}: ${Math.round(runtimeMs)} ms ${measures.internalMetres === undefined ? 'city' : `${Math.round(measures.internalMetres as number)} m internal`}`);
}
writeFileSync(join(out, 'metrics.json'), JSON.stringify({ revision, dirty, heldOut, metricVersion: 1, turnWindowM: 4, rows }, null, 2));
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Village road comparison</title><style>body{font:15px system-ui;margin:24px;background:#eee}article{background:white;padding:16px;margin:16px 0}h2{font-size:18px}p{max-height:70px;overflow:auto;font:12px monospace}.landscape{width:100%;height:450px}.pair{display:flex}.pair object{width:50%;height:550px;flex:1}</style><h1>Village road review</h1><p>${escape(revision)}${dirty ? ' + source changes' : ''}. Matched pairs show previous/current at the same scale. Unpaired cases show current only. Click current drawing to isolate roads.</p>${cards.join('\n')}`);
