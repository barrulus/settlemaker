/**
 * G1 — the trunks-only render gate (plan 2026-08-25, task 6).
 *
 * Draws the trunk network ALONE over empty ground: no green, no fabric, no
 * dressing. `synthesizeTrunks` is called directly, so what appears here is
 * exactly what the boundary contract and the convergence palette produced
 * and nothing that growth later lays on top of it.
 *
 * What is drawn, and why each mark is there to be judged:
 *   - the contract circle, dashed        -- where FMG's routes hand over
 *   - each entry stub, hatched           -- one per route at its EXACT bearing
 *   - trunk polylines, stroked by class  -- class stiffness should be visible
 *   - junction dots                      -- staggering should be visible
 *   - the aim, a small cross             -- where the network converges
 *
 * Usage:
 *   nix develop --command bash -c "npx tsx scripts/render-trunks.ts"
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Point } from '../src/types/point.js';
import { SeededRandom } from '../src/utils/random.js';
import { buildSite } from '../src/village/site.js';
import { contractRadiusFor, synthesizeTrunks } from '../src/village/skeleton/trunks.js';
import { discRadiusFor } from '../src/village/skeleton/lanes.js';
import { waterPushedCentre } from '../src/village/skeleton/green-siting.js';
import { buildDeck, ordinaryOccupancy, minDwellingFrontageM } from '../src/village/deck.js';
import { gapForPopulation } from '../src/village/parcels/lots.js';
import { laneWidth } from '../src/village/route-class.js';
import { AIM_CLEAR_RADIUS_M } from '../src/village/constants.js';
import { SCENARIOS } from './probe-afmg.js';

const OUT_DIR = '/home/barrulus/settlemaker-village-gate';
const PX_PER_M = 2.2;
const PAD_M = 30;

const WANTED = ['panel-through', 'panel-cross', 'panel-royal', 'tri', 'hub', 'fan'];
const POPS = [300, 900];
const SEEDS = [1, 2, 3];

const n = (x: number): string => (Math.round(x * 100) / 100).toString();

function networkFor(input: ReturnType<typeof SCENARIOS[number]['input']>, seed: number) {
  const rng = new SeededRandom(seed);
  const site = buildSite(input);
  // Mirrors `generateVillage`'s own ordering exactly: deck, then the closed
  // form, then the water-pushed aim, then the network.
  const { entries: deck } = buildDeck(site.biome, site.population, rng);
  const closedFormRadius = discRadiusFor(
    Math.ceil(site.population / ordinaryOccupancy(deck)),
    minDwellingFrontageM(deck) + gapForPopulation(site.population),
  );
  const aim = waterPushedCentre(new Point(0, 0), AIM_CLEAR_RADIUS_M, site.water).centre;
  const network = synthesizeTrunks(
    site, contractRadiusFor(closedFormRadius), closedFormRadius, rng, aim,
  );
  return { network, closedFormRadius };
}

function svgFor(
  label: string,
  network: ReturnType<typeof networkFor>['network'],
  builtEdgeRadiusM: number,
): string {
  const R = network.contractRadiusM;
  const span = (R + PAD_M) * 2;
  const w = span * PX_PER_M;
  const X = (x: number): number => (x + R + PAD_M) * PX_PER_M;
  const Y = (y: number): number => (y + R + PAD_M) * PX_PER_M;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(w)}" viewBox="0 0 ${n(w)} ${n(w)}">`);
  out.push('<rect data-bg="paper" width="100%" height="100%" fill="#f4efe4"/>');

  // The built edge growth WOULD saturate, for scale only.
  out.push(`<circle cx="${n(X(0))}" cy="${n(Y(0))}" r="${n(builtEdgeRadiusM * PX_PER_M)}" `
    + 'fill="none" stroke="#c9bfa8" stroke-width="1" stroke-dasharray="2 4"/>');
  // The contract circle.
  out.push(`<circle cx="${n(X(0))}" cy="${n(Y(0))}" r="${n(R * PX_PER_M)}" `
    + 'fill="none" stroke="#9a8f78" stroke-width="1.2" stroke-dasharray="7 5"/>');

  // Entry stubs: FMG's hatched marks, outside the circle, at exact bearings.
  for (const e of network.entries) {
    const ux = e.point.x / R;
    const uy = e.point.y / R;
    const a = new Point(e.point.x + ux * 6, e.point.y + uy * 6);
    const b = new Point(e.point.x + ux * 20, e.point.y + uy * 20);
    out.push(`<line x1="${n(X(a.x))}" y1="${n(Y(a.y))}" x2="${n(X(b.x))}" y2="${n(Y(b.y))}" `
      + `stroke="#6b6250" stroke-width="${n(Math.max(2, laneWidth(e.route.type) * PX_PER_M))}" `
      + 'stroke-dasharray="3 3"/>');
  }

  // The trunks themselves, stroked at their true class width.
  for (const t of network.trunks) {
    if (t.points.length < 2) continue;
    const d = t.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(X(p.x))} ${n(Y(p.y))}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="#3d3527" stroke-linecap="round" `
      + `stroke-linejoin="round" stroke-width="${n(Math.max(1.2, laneWidth(t.type) * PX_PER_M))}"/>`);
  }

  // Junctions, so staggering is visible at a glance.
  for (const j of network.junctions) {
    out.push(`<circle cx="${n(X(j.position.x))}" cy="${n(Y(j.position.y))}" r="3" `
      + 'fill="none" stroke="#a8432c" stroke-width="1.4"/>');
  }

  // The aim.
  const ax = X(network.aim.x);
  const ay = Y(network.aim.y);
  out.push(`<path d="M${n(ax - 5)} ${n(ay)} L${n(ax + 5)} ${n(ay)} M${n(ax)} ${n(ay - 5)} L${n(ax)} ${n(ay + 5)}" `
    + 'stroke="#2f6d55" stroke-width="1.4"/>');

  out.push(`<text x="10" y="20" font-family="monospace" font-size="13" fill="#3d3527">${label}</text>`);
  out.push('</svg>');
  return out.join('');
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rows: string[] = [];
  for (const name of WANTED) {
    const sc = SCENARIOS.find((s) => s.name === name);
    if (!sc) throw new Error(`no scenario ${name}`);
    for (const pop of POPS) {
      for (const seed of SEEDS) {
        const { network, closedFormRadius } = networkFor(sc.input(pop), seed);
        const drawn = network.trunks.filter((t) => t.points.length >= 2);
        const label = `${name} pop ${pop} seed ${seed} — ${network.pattern}, `
          + `${drawn.length} trunks, ${network.junctions.length} junctions`;
        const svg = svgFor(label, network, closedFormRadius);
        const stem = path.join(OUT_DIR, `trunks-${name}-${pop}-s${seed}`);
        fs.writeFileSync(`${stem}.svg`, svg);
        await sharp(Buffer.from(svg)).png().toFile(`${stem}.png`);
        rows.push(`${name.padEnd(14)} pop ${pop} s${seed} | ${network.pattern.padEnd(12)}`
          + ` | trunks ${String(drawn.length).padStart(2)}`
          + ` | junctions ${String(network.junctions.length).padStart(2)}`
          + ` | contractR ${Math.round(network.contractRadiusM)}`
          + ` | builtEdge ${Math.round(closedFormRadius)}`);
      }
    }
  }
  process.stdout.write(`${rows.join('\n')}\n`);
  process.stdout.write(`\n${rows.length} renders -> ${OUT_DIR}\n`);
}

main().catch((e) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
