// Run after build:lib. An explicit --engine allows unchanged/candidate bundles
// to share this exact fixture matrix without copying benchmark logic.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { cpus, platform, release } from 'node:os';
import { reviewSettlementGround } from '../dist/settlement/quality.js';

const { values } = parseArgs({ options: {
  engine: { type: 'string', default: 'dist/settlemaker.browser.js' },
  output: { type: 'string', default: 'output/generation-benchmark.json' },
  revision: { type: 'string', default: 'unspecified' },
  quick: { type: 'boolean', default: false },
  svg: { type: 'string' },
} });
const enginePath = resolve(values.engine);
const api = await import(pathToFileURL(enginePath).href);
const base = {
  name: 'Generation and viewer review', biome: 'temperate', walls: true,
  plaza: true, temple: true, port: false, citadel: false, shanty: false,
  capital: false, roadBearings: [20, 145, 270],
};
const populations = values.quick ? [800, 2000, 50000] : [300, 800, 2000, 10000, 50000, 100000, 200000, 250000];
const fixtures = [
  { name: 'village-1000', input: { ...base, population: 1000 }, preset: 'village' },
  ...populations.map(population => ({ name: `city-${population}`, input: { ...base, population }, preset: 'city' })),
  ...(!values.quick ? [{ name: 'coastal-city-10000', input: { ...base, population: 10000, coastlineGeometry: [[{x:500,y:-10000},{x:10000,y:-10000},{x:10000,y:10000},{x:500,y:10000}]] }, preset: 'city' }] : []),
];
const area = ring => Math.abs(new api.Polygon(ring.map(p => new api.Point(p.x, p.y))).square);
const quantiles = values => {
  const sorted = [...values].sort((a,b) => a-b);
  return Object.fromEntries([.1,.5,.9,.99].map(p => [`p${p*100}`, sorted[Math.min(sorted.length-1, Math.floor(sorted.length*p))] ?? 0]));
};
const measured = fn => { const start = performance.now(); const value = fn(); return { value, ms: performance.now()-start }; };
const results = {
  capturedAt: new Date().toISOString(), revision: values.revision,
  artifactSha256: createHash('sha256').update(await readFile(enginePath)).digest('hex'),
  build: api.BUILD_INFO ?? null, runtime: process.version,
  machine: { platform: platform(), release: release(), cpu: cpus()[0]?.model },
  note: 'Sequential single runs, not percentiles of latency. First fixture includes cold/JIT costs. Run without competing CPU-heavy work for timing comparisons.',
  cases: [],
};
if (values.svg) await mkdir(values.svg, { recursive: true });
for (const fixture of fixtures) for (const seed of values.quick ? [2] : [2, 7]) {
  const timings = [];
  const options = { seed, development: { preset: fixture.preset }, onStageTiming: timing => timings.push(timing) };
  const generation = measured(() => api.createSettlementModel(fixture.input, options));
  const model = generation.value;
  const overview = measured(() => api.renderSettlement(model, { width: 1600 }));
  const full = measured(() => api.renderSettlement(model, { detail: 'full' }));
  const closeBounds = { min_x: -100, min_y: -100, max_x: 100, max_y: 100 };
  const close = measured(() => api.renderSettlement(model, { width: 1000, bounds: closeBounds }));
  // The first crop includes lazy spatial-index construction; report reuse
  // separately instead of hiding that cost in a misleading warm-only number.
  const closeWarm = measured(() => api.renderSettlement(model, { width: 1000, bounds: closeBounds }));
  const exported = measured(() => api.exportSettlement(model));
  const L = model.scene.layers;
  const coreDistricts = model.districts.filter(d => d.insideWalls);
  const coreIds = new Set(model.buildings.filter(b => b.insideWalls).map(b => b.id));
  const coreHomes = model.buildings.filter(b => b.insideWalls);
  const outerHomes = model.buildings.filter(b => !b.insideWalls);
  const groundReview = fixture.preset === 'city' ? measured(() => reviewSettlementGround(model)) : null;
  const row = {
    fixture: fixture.name, seed, input: fixture.input, development: model.development,
    milliseconds: { generation: generation.ms, overview: overview.ms, full: full.ms, close: close.ms, closeWarm: closeWarm.ms, geojson: exported.ms, groundReview: groundReview?.ms ?? 0 },
    timings, residents: model.residents, diagnostics: model.diagnostics,
    counts: { buildings: L.buildings.length, homes: model.buildings.length, districts: model.districts.length, roads: L.roads.length, greens: L.greens.length, fields: L.fields.length, vegetation: L.vegetation.length, symbols: L.symbols.length, features: exported.value.features.length },
    bytes: { overview: Buffer.byteLength(overview.value), full: Buffer.byteLength(full.value), close: Buffer.byteLength(close.value) },
    quality: {
      ground: groundReview?.value ?? null,
      coreRoofArea: L.buildings.filter(b => coreIds.has(b.id)).reduce((n,b) => n+area(b.ring),0),
      coreDistrictArea: coreDistricts.reduce((n,d) => n+area(d.boundary),0),
      coreHomeArea: quantiles(coreHomes.map(b => area(b.footprint))),
      outerHomeArea: quantiles(outerHomes.map(b => area(b.footprint))),
      greenArea: L.greens.reduce((n,g) => n+area(g.ring),0),
      publicGreenArea: L.greens.filter(g => g.purpose === 'public').reduce((n,g) => n+area(g.ring),0),
      naturalArea: L.greens.filter(g => g.purpose === 'natural').reduce((n,g) => n+area(g.ring),0),
    },
  };
  results.cases.push(row);
  console.log(`${fixture.name} seed=${seed}: generation ${generation.ms.toFixed(0)} ms, ${L.buildings.length} buildings, unassigned ${model.residents.unassigned}`);
  if (values.svg && seed === 2 && ['city-800','city-2000','city-50000','city-200000'].includes(fixture.name)) {
    for (const [suffix, svg] of [['overview', overview.value], ['core', close.value]]) {
      await writeFile(resolve(values.svg, `${fixture.name}-${suffix}.svg`), svg);
    }
  }
}
await mkdir(dirname(resolve(values.output)), { recursive: true });
await writeFile(values.output, JSON.stringify(results, null, 2)+'\n');
console.log(`Saved ${values.output}`);
