/**
 * Probe script: sweeps population x seed (plus two extra fixtures) through
 * the full village pipeline and prints one summary row per village. This is
 * a report, not a test — it always exits 0.
 *   nix develop --command bash -c "npx tsx scripts/probe-village.ts"
 */
import { Point } from '../src/types/point.js';
import { generateVillage } from '../src/village/village-model.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const POPULATIONS = [40, 80, 150, 300, 600, 900];
const SEEDS = [1, 2];

const baseFixture = (population: number): AzgaarBurgInput => ({
  name: 'Probe', population, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
});

const throughRouteFixture: AzgaarBurgInput = {
  name: 'Crossroads', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 0, kind: 'road', through: true },
    { bearing_deg: 180, kind: 'road', through: true },
    { bearing_deg: 90, kind: 'road' },
  ],
};

const coastalWater = [[
  { x: 60, y: -200 }, { x: 400, y: -200 }, { x: 400, y: 400 }, { x: 60, y: 400 },
]].map((ring) => ring.map((p) => new Point(p.x, p.y)));

const coastalFixture: AzgaarBurgInput = {
  name: 'Shoreside', population: 300, port: true, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 0, kind: 'road' }, { bearing_deg: 140, kind: 'foot' }],
  coastlineGeometry: coastalWater,
};

interface Row {
  label: string;
  input: AzgaarBurgInput;
  seed: number;
}

const rows: Row[] = [];
for (const pop of POPULATIONS) {
  for (const seed of SEEDS) {
    rows.push({ label: `pop=${pop}`, input: baseFixture(pop), seed });
  }
}
rows.push({ label: 'through-route', input: throughRouteFixture, seed: 1 });
rows.push({ label: 'coastal', input: coastalFixture, seed: 1 });

function extentM(xs: number[], ys: number[]): string {
  if (xs.length === 0) return '0x0';
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return `${Math.round(w)}x${Math.round(h)}`;
}

const header = [
  'label', 'seed', 'buildings', 'housed/target', 'lanes', 'lots', 'crofts',
  'fields', 'trees', 'poiKinds', 'edgeStyle', 'extentM', 'boathouse', 'diagnostics',
].join(' | ');
process.stdout.write(`${header}\n`);
process.stdout.write(`${'-'.repeat(header.length)}\n`);

for (const { label, input, seed } of rows) {
  const model = generateVillage(input, seed);

  const housed = model.buildings.reduce((s, b) => s + b.occupancy, 0);
  const lanePoints = model.lanes.flatMap((l) => l.points);
  const fieldPoints = model.fields.flatMap((f) => f.polygon);
  const croftPoints = model.crofts.flatMap((c) => c.polygon);
  const xs = model.buildings.map((b) => b.position.x)
    .concat(model.green.centre.x, lanePoints.map((p) => p.x), fieldPoints.map((p) => p.x), croftPoints.map((p) => p.x));
  const ys = model.buildings.map((b) => b.position.y)
    .concat(model.green.centre.y, lanePoints.map((p) => p.y), fieldPoints.map((p) => p.y), croftPoints.map((p) => p.y));

  const poiKinds = Array.from(new Set(model.pois.map((p) => p.kind))).sort().join(',') || '-';
  const boathouse = model.pois.some((p) => p.kind === 'boathouse') ? 'yes' : 'no';
  const diagnostics = model.diagnostics.length > 0 ? model.diagnostics.join('; ') : '-';

  const row = [
    label,
    String(seed),
    String(model.buildings.length),
    `${housed}/${input.population}`,
    String(model.lanes.length),
    String(model.lots.length),
    String(model.crofts.length),
    String(model.fields.length),
    String(model.vegetation.length),
    poiKinds,
    model.edgeStyle,
    extentM(xs, ys),
    boathouse,
    diagnostics,
  ].join(' | ');
  process.stdout.write(`${row}\n`);
}

process.exit(0);
