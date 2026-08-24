/**
 * AFMG CONTRACT SIMULATION PROBE (2026-08-24, scouting task).
 *
 * The owner is about to receive a richer input contract from AFMG — route
 * directions and classes, water bearings, river detail. This script asks
 * what the village engine does with that data TODAY, by feeding it a
 * scenario matrix at fixed populations and reporting one row per scenario.
 *
 *   nix develop --command bash -c "npx tsx scripts/probe-afmg.ts"
 *   nix develop --command bash -c "npx tsx scripts/probe-afmg.ts --render"
 *
 * A report, not a test — it always exits 0 and asserts nothing. `--render`
 * additionally writes an SVG (and a no-vegetation variant) per scenario to
 * RENDER_DIR.
 *
 * Metric definitions are borrowed VERBATIM from scripts/gate-metrics.ts so
 * the numbers are comparable with the gate-8 rows: `R` is the p95 building
 * radius, `axis` is the ratio of the 3-bin-smoothed per-bearing p95 radius
 * (gate 8's "bldg smooth ratio", the elongation reading), `blocks` is
 * `blockAreas`. gate-metrics.ts is a top-level script with no exports, so
 * those three readings are restated here rather than imported; everything
 * else on the row is new and specific to the water/route question.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { Point } from '../src/types/point.js';
import { generateVillage } from '../src/village/village-model.js';
import { renderVillage } from '../src/village/render.js';
import { blockAreas } from '../src/village/skeleton/blocks.js';
import { inAnyWater, dist } from '../src/village/geometry.js';
import {
  buildingRadiusProfile, crossings, widestLanelessSectorDeg, inkGapMedians,
  landUseBodyPct, fieldPolarShare, interiorDeadEnds,
} from './metrics-lib.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import type { VillageModel } from '../src/village/types.js';

const RENDER_DIR = '/home/barrulus/settlemaker-village-gate';
const POPS = [300, 900];
const SEED = 1;

const flags = {
  port: false, citadel: false, walls: false, plaza: false,
  temple: false, shanty: false, capital: false,
};

/** A long thin polygon standing in for a river: the only way a river can be
 * expressed under today's contract, which knows water as polygons only. */
function riverBand(
  bearingDeg: number, offsetM: number, halfWidthM: number, lengthM: number,
): Array<{ x: number; y: number }> {
  const r = (bearingDeg * Math.PI) / 180;
  const dx = Math.sin(r); const dy = -Math.cos(r);
  const nx = -dy; const ny = dx;
  const c = { x: nx * offsetM, y: ny * offsetM };
  const corner = (a: number, b: number): { x: number; y: number } => ({
    x: c.x + dx * a + nx * b, y: c.y + dy * a + ny * b,
  });
  return [
    corner(-lengthM, -halfWidthM), corner(lengthM, -halfWidthM),
    corner(lengthM, halfWidthM), corner(-lengthM, halfWidthM),
  ];
}

interface Scenario { name: string; note: string; input: (pop: number) => AzgaarBurgInput }

export const SCENARIOS: Scenario[] = [
  {
    name: 'baseline',
    note: 'one main road at 225, no water — identical to the gate-8 fixture',
    input: (population) => ({
      name: 'Probe', population, ...flags,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    }),
  },
  {
    name: 'crossroads',
    note: 'two through main routes at right angles',
    input: (population) => ({
      name: 'Probe', population, ...flags,
      roadBearings: [
        { bearing_deg: 0, kind: 'main', through: true, route_id: 'r-ns' },
        { bearing_deg: 90, kind: 'main', through: true, route_id: 'r-ew' },
      ],
    }),
  },
  {
    name: 'tri',
    note: 'THREE mixed-class routes at irregular bearings — a real AFMG minor junction burg (task 4 acceptance matrix)',
    input: (population) => ({
      name: 'Probe', population, ...flags,
      roadBearings: [
        { bearing_deg: 40, kind: 'main', through: true, route_id: 'r-main' },
        { bearing_deg: 165, kind: 'town', route_id: 'r-town' },
        { bearing_deg: 290, kind: 'trail', route_id: 'r-trail' },
      ],
    }),
  },
  {
    name: 'hub',
    note: 'five mixed-class routes at irregular bearings — a real AFMG junction burg',
    input: (population) => ({
      name: 'Probe', population, ...flags,
      roadBearings: [
        { bearing_deg: 12, kind: 'royal', through: true, route_id: 'r-royal' },
        { bearing_deg: 78, kind: 'main', route_id: 'r-main' },
        { bearing_deg: 155, kind: 'town', route_id: 'r-town' },
        { bearing_deg: 231, kind: 'trail', route_id: 'r-trail' },
        { bearing_deg: 304, kind: 'footpath', route_id: 'r-foot' },
      ],
    }),
  },
  {
    name: 'coastal',
    note: 'port, a real coastline 90 m off to the east, two roads along the shore',
    input: (population) => ({
      name: 'Probe', population, ...flags, port: true,
      roadBearings: [
        { bearing_deg: 10, kind: 'main', through: true, route_id: 'r-shore' },
        { bearing_deg: 250, kind: 'town', route_id: 'r-inland' },
      ],
      coastlineGeometry: [[
        { x: 90, y: -600 }, { x: 900, y: -600 }, { x: 900, y: 600 }, { x: 90, y: 600 },
      ]],
    }),
  },
  {
    name: 'river-poly',
    note: 'a 24 m-wide water band running NE-SW 40 m off centre, with a road crossing it',
    input: (population) => ({
      name: 'Probe', population, ...flags, port: true,
      roadBearings: [
        { bearing_deg: 135, kind: 'main', through: true, route_id: 'r-cross' },
        { bearing_deg: 45, kind: 'town', through: true, route_id: 'r-along' },
      ],
      coastlineGeometry: [riverBand(45, 40, 12, 900)],
    }),
  },
  {
    name: 'river-centre',
    note: 'THE AWKWARD ONE: the same band running straight through the green',
    input: (population) => ({
      name: 'Probe', population, ...flags, port: true,
      roadBearings: [
        { bearing_deg: 135, kind: 'main', through: true, route_id: 'r-cross' },
      ],
      coastlineGeometry: [riverBand(45, 0, 12, 900)],
    }),
  },
  {
    name: 'brook',
    note: 'FAILURE HUNT: a 4 m stream (real AFMG river width) through the green',
    input: (population) => ({
      name: 'Probe', population, ...flags, port: true,
      roadBearings: [{ bearing_deg: 135, kind: 'main', through: true, route_id: 'r-cross' }],
      coastlineGeometry: [riverBand(45, 0, 2, 900)],
    }),
  },
  {
    name: 'inert-fields',
    note: 'BASELINE plus followsRiver + relief on every route — expected byte-identical',
    input: (population) => ({
      name: 'Probe', population, ...flags,
      roadBearings: [{
        bearing_deg: 225, kind: 'road', followsRiver: true, relief: 'valley',
      }],
    }),
  },
  {
    name: 'fan',
    note: 'FAILURE HUNT: eight routes, three of them within 2 deg of each other',
    input: (population) => ({
      name: 'Probe', population, ...flags,
      roadBearings: [
        { bearing_deg: 90.0, kind: 'main', route_id: 'a' },
        { bearing_deg: 90.5, kind: 'main', route_id: 'b' },
        { bearing_deg: 91.2, kind: 'town', route_id: 'c' },
        { bearing_deg: 130, kind: 'local', route_id: 'd' },
        { bearing_deg: 170, kind: 'trail', route_id: 'e' },
        { bearing_deg: 210, kind: 'footpath', route_id: 'f' },
        { bearing_deg: 250, kind: 'main', through: true, route_id: 'g' },
        { bearing_deg: 330, kind: 'royal', route_id: 'h' },
      ],
    }),
  },
  {
    name: 'strangled',
    note: 'FAILURE HUNT: water on three sides, ~70 m of dry land left',
    input: (population) => ({
      name: 'Probe', population, ...flags, port: true,
      roadBearings: [{ bearing_deg: 180, kind: 'main', route_id: 'r-neck' }],
      coastlineGeometry: [
        [{ x: 70, y: -900 }, { x: 900, y: -900 }, { x: 900, y: 900 }, { x: 70, y: 900 }],
        [{ x: -900, y: -900 }, { x: -70, y: -900 }, { x: -70, y: 900 }, { x: -900, y: 900 }],
        [{ x: -900, y: -900 }, { x: 900, y: -900 }, { x: 900, y: -70 }, { x: -900, y: -70 }],
      ],
    }),
  },
];

// ---------------------------------------------------------------- metrics
const BINS = 24;
const bearing = (c: Point, p: { x: number; y: number }): number =>
  ((Math.atan2(p.x - c.x, -(p.y - c.y)) * 180) / Math.PI + 360) % 360;

function p95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)))];
}

function shoelace(poly: Array<{ x: number; y: number }>): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Metres of lane polyline lying inside a water polygon — a lane crossing a
 * river with no bridge, measured. Sampled at 1 m, which is finer than the
 * lane's own 4 m sample step. */
function laneMetresInWater(model: VillageModel): number {
  if (model.site.water.length === 0) return 0;
  let wet = 0;
  for (const lane of model.lanes) {
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1]; const b = lane.points[i];
      const L = dist(a, b);
      const steps = Math.max(1, Math.ceil(L));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const p = new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        if (inAnyWater(p, model.site.water)) wet += L / steps;
      }
    }
  }
  return wet;
}

function countInWater(points: Point[], water: Point[][]): number {
  if (water.length === 0) return 0;
  return points.filter((p) => inAnyWater(p, water)).length;
}

export interface Row { [k: string]: string }

export function measure(name: string, pop: number, model: VillageModel): Row {
  const c = model.green.centre;
  const perBin: number[][] = Array.from({ length: BINS }, () => []);
  const allD: number[] = [];
  for (const b of model.buildings) {
    const d = dist(c, b.position);
    allD.push(d);
    perBin[Math.floor(bearing(c, b.position) / (360 / BINS)) % BINS].push(d);
  }
  allD.sort((a, b) => a - b);
  const R = p95(allD);
  const binR: Array<number | null> = perBin.map((xs) =>
    xs.length ? p95([...xs].sort((a, b) => a - b)) : null);
  const smooth = binR.map((_, i) => {
    const w = [-1, 0, 1].map((k) => binR[(i + k + BINS) % BINS])
      .filter((x): x is number => x !== null);
    return w.length ? w.reduce((s, x) => s + x, 0) / w.length : null;
  }).filter((x): x is number => x !== null);
  const axis = smooth.length >= 2 ? Math.max(...smooth) / Math.min(...smooth) : NaN;

  const fieldArea = model.fields.reduce((s, f) => s + shoelace(f.polygon), 0);
  const water = model.site.water;
  const wetLane = laneMetresInWater(model);
  const wetBuildings = countInWater(model.buildings.map((b) => b.position), water);
  const wetFieldVerts = countInWater(model.fields.flatMap((f) => f.polygon), water);
  const wetVeg = countInWater(model.vegetation.map((v) => v.position), water);

  // Standing bars (task 4): reuse gate-metrics.ts's own formulas via
  // scripts/metrics-lib.ts, not a reimplementation.
  const profile = buildingRadiusProfile(model);
  const cross = crossings(model);
  const sector = widestLanelessSectorDeg(model, profile.bodyAt);
  const ink = inkGapMedians(model);
  const landuse = landUseBodyPct(model, profile.R, profile.bodyAt);
  const polar = fieldPolarShare(model);
  const dead = interiorDeadEnds(model, profile.R);

  return {
    scenario: name,
    pop: String(pop),
    bldg: String(model.buildings.length),
    housed: `${model.buildings.reduce((s, b) => s + b.occupancy, 0)}/${pop}`,
    lanes: String(model.lanes.length),
    blocks: String(blockAreas(model.lanes, model.green).length),
    axis: Number.isFinite(axis) ? axis.toFixed(2) : 'n/a',
    R: R.toFixed(0),
    green: `${model.green.shape.replace('sm-green-', '')} ${Math.round(model.green.diameter)}m`,
    fields: String(model.fields.length),
    fieldkm2: (fieldArea / 1000).toFixed(1) + 'k',
    veg: String(model.vegetation.length),
    poi: Array.from(new Set(model.pois.map((p) => p.kind))).sort().join(',') || '-',
    wetLaneM: wetLane.toFixed(0),
    wetBldg: String(wetBuildings),
    wetField: String(wetFieldVerts),
    wetVeg: String(wetVeg),
    cross: String(cross),
    stubs: `${dead.deadEnds}/${dead.interior}`,
    sector: String(sector),
    inkgap: ink.adjMed.toFixed(2),
    landuseBody: landuse.toFixed(0) + '%',
    aniso: `${profile.smoothRatio.toFixed(2)}/${profile.smoothCv.toFixed(3)}`,
    curvedPct: (100 * polar.bowedShare).toFixed(0) + '%',
    diag: model.diagnostics.length ? model.diagnostics.join('; ') : '-',
  };
}

// ------------------------------------------------------------------- main
// Guarded so another script can `import { SCENARIOS, measure }` without the
// whole matrix running as a side effect of the import.
function main(): void {
const doRender = process.argv.includes('--render');
if (doRender) mkdirSync(RENDER_DIR, { recursive: true });
// --seed=N,M,... : run each named seed instead of just SEED (task 4: "at
// least two other seeds" for the census/blocks numbers). --only=name,name
// restricts to a subset of scenarios (useful once the matrix has 12+ rows).
const seedArg = process.argv.find((a) => a.startsWith('--seed='));
const seeds = seedArg ? seedArg.slice('--seed='.length).split(',').map(Number) : [SEED];
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
const scenarios = only ? SCENARIOS.filter((sc) => only.has(sc.name)) : SCENARIOS;

const rows: Row[] = [];
for (const sc of scenarios) {
  for (const pop of POPS) {
  for (const seed of seeds) {
    const input = sc.input(pop);
    let model: VillageModel;
    try {
      model = generateVillage(input, seed);
    } catch (e) {
      rows.push({ scenario: sc.name, pop: String(pop), seed: String(seed), diag: `THREW: ${(e as Error).message}` });
      process.stderr.write(`!! ${sc.name} pop ${pop} seed ${seed} THREW: ${(e as Error).stack}\n`);
      continue;
    }
    rows.push({ seed: String(seed), ...measure(sc.name, pop, model) });

    // Determinism: the same input and seed must produce the same SVG.
    const svg = renderVillage(model);
    const again = renderVillage(generateVillage(sc.input(pop), seed));
    if (svg !== again) process.stderr.write(`!! ${sc.name} pop ${pop} seed ${seed} NOT DETERMINISTIC\n`);

    if (doRender && seed === SEED) {
      writeFileSync(`${RENDER_DIR}/afmg-${sc.name}-${pop}.svg`, svg);
      const bare = generateVillage(sc.input(pop), seed);
      bare.vegetation = [];
      writeFileSync(`${RENDER_DIR}/afmg-${sc.name}-${pop}-nofauna.svg`, renderVillage(bare));
    }
  }
  }
}

const COLS = ['scenario', 'pop', 'seed', 'bldg', 'housed', 'lanes', 'blocks', 'axis', 'R',
  'cross', 'stubs', 'sector', 'inkgap', 'landuseBody', 'aniso', 'curvedPct',
  'green', 'fields', 'fieldkm2', 'veg', 'poi', 'wetLaneM', 'wetBldg', 'wetField',
  'wetVeg', 'diag'];
const width = (col: string): number =>
  Math.max(col.length, ...rows.map((r) => (r[col] ?? '').length));
const line = (r: Row): string =>
  COLS.map((col) => (r[col] ?? '').padEnd(width(col))).join(' | ');
process.stdout.write(`${COLS.map((col) => col.padEnd(width(col))).join(' | ')}\n`);
process.stdout.write(`${'-'.repeat(COLS.reduce((s, col) => s + width(col) + 3, 0))}\n`);
for (const r of rows) process.stdout.write(`${line(r)}\n`);
for (const sc of scenarios) process.stdout.write(`\n${sc.name}: ${sc.note}`);
process.stdout.write('\n');
}

if (process.argv[1]?.endsWith('probe-afmg.ts')) {
  main();
  process.exit(0);
}
