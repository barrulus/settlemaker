import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import * as current from '../src/index.js';
import { buildingBudget } from '../src/generator/model.js';
import { REFINED_GLYPHS } from '../src/assets/refined-glyphs.js';
import { REFINED_INK } from '../src/assets/refined-ink.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import { cropReviewSvg } from './city-review-crop.js';
import type { Park } from '../src/wards/park.js';

const base: AzgaarBurgInput = {
  name: 'City glyph baseline', population: 2500, biome: 'temperate',
  walls: true, plaza: true, temple: true, port: false, citadel: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 18, kind: 'main', route_id: 'a' },
    { bearing_deg: 142, kind: 'town', route_id: 'b' },
    { bearing_deg: 267, kind: 'local', route_id: 'c' },
  ],
};
const exempt = new Set(['castle', 'cathedral', 'market', 'harbour', 'park']);
const panel = [
  ...[1000, 1001, 1200, 2500, 5000, 10000, 25000, 50000, 100000, 250000].map(population => ({
    id: `temperate-${population}`, seed: 2, input: { ...base, population },
  })),
  ...['desert', 'tundra', 'tropical', 'coastal'].map((biome, i) => ({
    id: `${biome}-2500`, seed: i % 2 ? 3 : 1, input: { ...base, biome },
  })),
  { id: 'unwalled-5000', seed: 3, input: { ...base, population: 5000, walls: false, trade: true } },
  { id: 'citadel-10000', seed: 1, input: { ...base, population: 10000, citadel: true, coreCapacity: 5000 } },
  { id: 'port-10000', seed: 3, input: { ...base, population: 10000, port: true, oceanBearing: 90 } },
  { id: 'portless-5000', seed: 1, input: { ...base, population: 5000, oceanBearing: 90 } },
  { id: 'no-routes-2500', seed: 3, input: { ...base, roadBearings: [] } },
  { id: 'park-4000', seed: 2, input: { ...base, population: 4000, roadBearings: [] } },
];

function measure(result: current.GenerateSettlementResult) {
  if (result.kind === 'village') return { kind: result.kind, buildings: result.model.buildings.length };
  const m = result.model;
  const ordinary = m.patches.filter(p => p.ward && !exempt.has(p.ward.type)).flatMap(p => p.ward!.geometry);
  const ordinarySet = new Set(ordinary);
  const linked = m.symbols.filter(s => s.building && ordinarySet.has(s.building));
  const byRegion = (core: boolean) => m.patches.filter(p => (p.zone === 'core') === core && p.ward && !exempt.has(p.ward.type))
    .reduce((sum, p) => sum + p.ward!.geometry.length, 0);
  const totalArea = ordinary.reduce((sum, p) => sum + Math.abs(p.square), 0);
  const backedArea = linked.reduce((sum, s) => sum + Math.abs(s.building!.square), 0);
  const paintedArea = linked.reduce((sum, s) => sum + (s.paintedArea ?? 0), 0);
  const target = buildingBudget(m.params.population, m.params.urbanDensity);
  const neighbourhoods = m.patches.filter(p => p.ward && ['craftsmen', 'merchant', 'gate', 'patriciate', 'slum', 'administration'].includes(p.ward.type));
  const blockArea = neighbourhoods.reduce((n, p) => n + Math.abs(p.ward!.getCityBlock().square), 0);
  const lots = neighbourhoods.flatMap(p => p.ward!.geometry);
  const lotSet = new Set(lots);
  const lotArea = lots.reduce((n, p) => n + Math.abs(p.square), 0);
  const blockGlyphs = linked.filter(s => lotSet.has(s.building!));
  const blockPaint = lotArea - blockGlyphs.reduce((n, s) => n + Math.abs(s.building!.square) - s.paintedArea!, 0);
  return {
    kind: result.kind, buildings: ordinary.length, target, budgetShortfall: Math.max(0, target - ordinary.length),
    coreBuildings: byRegion(true), outerBuildings: byRegion(false),
    neighbourhoodCoverage: lotArea / blockArea,
    neighbourhoodPaintCoverage: blockPaint / blockArea,
    plannedBuildings: neighbourhoods.reduce((n, p) => n + p.ward!.geometry.filter(b => p.ward!.buildingFrontages?.has(b)).length, 0),
    streetRuns: neighbourhoods.reduce((n, p) => n + (p.ward!.streetRuns?.length ?? 0), 0),
    glyphBuildings: linked.length, glyphCountCoverage: linked.length / ordinary.length,
    glyphFootprintAreaCoverage: backedArea / totalArea,
    estimatedGlyphPaintedArea: paintedArea,
    estimatedPaintRetention: (totalArea - backedArea + paintedArea) / totalArea,
    glyphs: [...new Set(linked.map(s => s.id))].sort(),
    homeGlyphs: [...new Set(linked.filter(s => ['craftsmen', 'merchant', 'gate', 'farm'].includes(s.wardType ?? '')).map(s => s.id))],
    templeGlyphs: m.symbols.filter(s => /cathedral|chapel|temple/.test(s.id)).length,
    alignedGlyphs: linked.filter(s => s.frontage).length,
    alleyCount: m.patches.reduce((sum, p) => sum + (p.ward?.lanes?.length ?? 0), 0),
    parks: m.patches.filter(p => p.ward?.type === 'park').map(p => {
      const park = p.ward as Park;
      return { paths: park.paths?.length ?? 0, trees: park.trees?.length ?? 0 };
    }),
    unavailablePhase1Symbols: [...new Set(m.symbols.filter(s => !REFINED_GLYPHS[s.id]).map(s => s.id))].sort(),
    degradedFlags: result.degradedFlags,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (key: string, fallback: string) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
  const out = resolve(value('--out', 'output/city-review/current'));
  const baselinePath = value('--baseline-module', '');
  const baseline: typeof current | null = baselinePath ? await import(pathToFileURL(resolve(baselinePath)).href) : null;
  mkdirSync(out, { recursive: true });
  const rows: Record<string, unknown>[] = [], cards: string[] = [];
  for (const f of panel) {
    const seed = f.seed + (args.includes('--held-out') ? 100 : 0);
    const images: string[] = [], results: current.GenerateSettlementResult[] = [];
    for (const [label, api] of [['before', baseline], ['after', current]] as const) {
      if (!api) continue;
      const heap = process.memoryUsage().heapUsed, start = performance.now();
      const result = api.generateSettlement(f.input, { seed });
      const elapsedMs = performance.now() - start;
      results.push(result);
      const stem = `${f.id}-${label}`;
      writeFileSync(join(out, `${stem}.svg`), result.svg);
      const measures = measure(result);
      rows.push({ id: f.id, label, seed, input: f.input, ...measures, elapsedMs,
        heapDeltaBytes: process.memoryUsage().heapUsed - heap, svgBytes: Buffer.byteLength(result.svg),
        gzipBytes: gzipSync(result.svg).length, svgElements: (result.svg.match(/<[a-zA-Z][^>]*>/g) ?? []).length,
        svgHash: createHash('sha256').update(result.svg).digest('hex'),
      });
      await sharp(Buffer.from(result.svg)).resize(900, 900, { fit: 'inside' }).png().toFile(join(out, `${stem}.png`));
      // Both city renderers use the same local coordinates. Fixed core crop,
      // independent of output resolution, is shared by the before/after pair.
      if (result.kind === 'settlement') {
        const detail = cropReviewSvg(result.svg, [-30, -30, 60, 60]);
        await sharp(Buffer.from(detail)).resize(900, 900).png().toFile(join(out, `${stem}-detail.png`));
        writeFileSync(join(out, `${stem}-detail.svg`), detail);
        const scene = api.buildScene(result.model);
        const roads = api.assembleSvg({ ...scene, layers: { ...scene.layers, buildings: [], symbols: [], vegetation: [] } });
        writeFileSync(join(out, `${stem}-roads.svg`), roads);
        const park = result.model.patches.find(p => p.ward?.type === 'park');
        if (park) {
          const x = park.shape.vertices.map(p => p.x), y = park.shape.vertices.map(p => p.y);
          const side = Math.max(Math.max(...x) - Math.min(...x), Math.max(...y) - Math.min(...y)) + 10;
          const box: [number, number, number, number] = [park.shape.centroid.x + result.originShift.dx - side / 2, park.shape.centroid.y + result.originShift.dy - side / 2, side, side];
          const parkSvg = cropReviewSvg(result.svg, box);
          await sharp(Buffer.from(parkSvg)).resize(600, 600).png().toFile(join(out, `${stem}-park.png`));
          writeFileSync(join(out, `${stem}-park.svg`), parkSvg);
        }
        const coord = (p: { x: number; y: number }) => `${p.x + result.originShift.dx},${p.y + result.originShift.dy}`;
        const outlines = result.model.symbols.filter(s => s.building).map(s => {
          const p = s.building!.vertices;
          const outline = `<path d="M${p.map(coord).join('L')}Z" fill="none" stroke="#147da6" stroke-width="0.08"/>`;
          return outline + (s.frontage ? `<path d="M${coord(s.building!.centroid)}L${coord(s.frontage.at)}" fill="none" stroke="#c62578" stroke-width="0.1"/>` : '');
        }).join('');
        writeFileSync(join(out, `${stem}-access.svg`), result.svg.replace('</svg>', `${outlines}</svg>`));
      }
      const hasPark = result.kind === 'settlement' && result.model.patches.some(p => p.ward?.type === 'park');
      images.push(`<div><b>${label}</b><p>${measures.buildings} buildings${'target' in measures ? ` / ${measures.target} target` : ''} · ${'glyphBuildings' in measures ? measures.glyphBuildings : 'village'} glyphs · ${elapsedMs.toFixed(0)} ms</p><a href="${stem}.svg"><img src="${stem}.png"></a>${result.kind === 'settlement' ? `<a href="${stem}-detail.svg"><img src="${stem}-detail.png"></a><a href="${stem}-roads.svg">Roads and land</a> · <a href="${stem}-access.svg">Footprints and access</a>` : ''}${hasPark ? `<h3>Park</h3><a href="${stem}-park.svg"><img src="${stem}-park.png"></a>` : ''}</div>`);
    }
    if (f.input.population === 1000 && results.length === 2 && results[0].svg !== results[1].svg) {
      throw new Error('Accepted village SVG changed');
    }
    cards.push(`<article><h2>${f.id} · seed ${seed}</h2><section>${images.join('')}</section></article>`);
    console.log(f.id);
  }
  writeFileSync(join(out, 'metrics.json'), JSON.stringify({
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).length > 0,
    baselineModule: baselinePath || null,
    notes: 'Synthetic inputs. Timings include generation + SVG + GeoJSON, exclude browser layout/paint. Heap deltas include GC noise. Painted areas are raster estimates. Building budgets are not housed population.',
    measuredAssets: Object.keys(REFINED_INK).length, rows,
  }, null, 2));
  writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>City neighbourhood review</title><style>body{font:16px system-ui;background:#eee;margin:24px}section{display:flex;gap:16px}section>div{flex:1;min-width:0}img{display:block;width:100%}article{background:white;padding:16px;margin:24px 0}p{font-size:14px}</style><h1>City neighbourhoods</h1><p>Whole map, matched core crops, and park details. Click images for SVG. One ordinary house style, one temple, and recorded street/alley frontage. Difficult lots retain polygon fallback. The existing housing budget shortfall remains. Access overlays show building-centre connections in pink and retained footprints in blue.</p><a href="metrics.json">Numerical report</a>${cards.join('')}`);
}
void main();
