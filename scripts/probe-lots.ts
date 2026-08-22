/**
 * Probe script (gate 6.7): WHERE the lots go.
 *
 * `probe-village.ts` reports one line per village. This one opens the lot
 * pipeline up: for each fixture it prints a per-cause histogram of every lot
 * CUT in the final feedback round — seated, or dead for one of six reasons —
 * plus the acceptance metrics the gate is judged on (frontage-housed share,
 * land use at 6 m, disc radius against its closed form, max void, widest
 * laneless sector, crossings, stubs, ink gaps).
 *
 * A report, not a test: it always exits 0.
 *   nix develop --command bash -c "npx tsx scripts/probe-lots.ts"
 */
import { Point } from '../src/types/point.js';
import { generateVillage } from '../src/village/village-model.js';
import { newLotTrace, type LotFate } from '../src/village/lot-trace.js';
import { discRadiusFor } from '../src/village/skeleton/lanes.js';
import { closestPointOnSegment, dist, segmentIntersection } from '../src/village/geometry.js';
import { inkExtent } from '../src/village/glyphs.js';
import { VOID_SPACING_M } from '../src/village/constants.js';
import { SeededRandom } from '../src/utils/random.js';
import { buildSite } from '../src/village/site.js';
import {
  buildDeck, eligible, minDwellingFrontageM, ordinaryOccupancy, widestDwellingWidthM,
} from '../src/village/deck.js';
import { gapForPopulation } from '../src/village/parcels/lots.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import type { Lane, VillageModel } from '../src/village/types.js';

const FIXTURES: Array<[number, number]> = [[300, 1], [600, 1], [900, 1], [900, 2], [300, 2]];

const fixture = (population: number): AzgaarBurgInput => ({
  name: 'Probe', population, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
});

const ORDER: LotFate[] = [
  'seated', 'lane-intrusion', 'building-overlap', 'no-deck-entry',
  'census-satisfied', 'converging-claim', 'clipped',
];

/** p95 of the buildings' distance from the green — the fabric's radius. */
function fabricRadiusM(m: VillageModel): number {
  const ds = m.buildings.map((b) => dist(b.position, m.green.centre)).sort((a, b) => a - b);
  return ds.length === 0 ? 0 : ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.95))];
}

/** A building's ink rectangle in its own frame. */
function obbOf(b: VillageModel['buildings'][number]): {
  c: Point; t: Point; n: Point; halfW: number; halfD: number;
} {
  const e = inkExtent(b.glyph, b.footprint);
  const rad = (b.bearingDeg * Math.PI) / 180;
  const n = new Point(Math.sin(rad), -Math.cos(rad));
  return {
    c: b.position, t: new Point(-n.y, n.x), n, halfW: e.width / 2, halfD: e.depth / 2,
  };
}

/** Exact distance from `p` to a building's ink rectangle (0 inside it). */
function distToInk(p: Point, o: ReturnType<typeof obbOf>): number {
  const d = new Point(p.x - o.c.x, p.y - o.c.y);
  const at = Math.abs(d.x * o.t.x + d.y * o.t.y) - o.halfW;
  const an = Math.abs(d.x * o.n.x + d.y * o.n.y) - o.halfD;
  return Math.hypot(Math.max(0, at), Math.max(0, an));
}

/**
 * Share of the fabric disc within `reachM` of a building's INK — the honest
 * version of the metric that flattered three gates in a row. Two rules that
 * make it strict:
 *  - measured against the exact ink rectangle, not a circumscribing circle;
 *  - the green is removed from BOTH numerator and denominator. It is
 *    deliberately open ground, so counting it as covered would reward a big
 *    green and counting it as void would punish one.
 */
function landUse(m: VillageModel, radiusM: number, reachM: number): number {
  const obbs = m.buildings.map(obbOf);
  let inside = 0;
  let covered = 0;
  for (let x = -radiusM; x <= radiusM; x += 3) {
    for (let y = -radiusM; y <= radiusM; y += 3) {
      if (Math.hypot(x, y) > radiusM) continue;
      const p = new Point(m.green.centre.x + x, m.green.centre.y + y);
      if (dist(p, m.green.centre) <= m.green.diameter / 2) continue;
      inside++;
      if (obbs.some((o) => distToInk(p, o) <= reachM)) covered++;
    }
  }
  return inside === 0 ? 0 : covered / inside;
}

/**
 * Frontage-housed share: of the frontage the village CUT, what fraction
 * carries a house. Measured from the trace's cut set, not from the surviving
 * lots — a lot dropped in resolution consumed frontage that a house could
 * have stood on, and dropping it from the denominator would report a fabric
 * housing 42% of its own plots as "89% housed". That flattering version is
 * exactly the class of metric this gate exists to stop trusting.
 */
function frontageHoused(cut: Map<string, number>, fates: Map<string, LotFate>): number {
  let offered = 0;
  let built = 0;
  for (const [id, frontage] of cut) {
    offered += frontage;
    if (fates.get(id) === 'seated') built += frontage;
  }
  return offered === 0 ? 0 : built / offered;
}

/**
 * The land-use figure as gates 6.4-6.6 measured it: ground within `reachM`
 * of a building's CENTRE, green included in the denominator. Kept because
 * the >= 65% bar was calibrated against it, and swapping in a different
 * (even better) definition mid-gate would be moving the goalposts. Reported
 * alongside the ink version so both are on the record.
 */
function landUseFromCentre(m: VillageModel, radiusM: number, reachM: number): number {
  let inside = 0;
  let covered = 0;
  for (let x = -radiusM; x <= radiusM; x += 3) {
    for (let y = -radiusM; y <= radiusM; y += 3) {
      if (Math.hypot(x, y) > radiusM) continue;
      const p = new Point(m.green.centre.x + x, m.green.centre.y + y);
      inside++;
      if (m.buildings.some((b) => dist(p, b.position) <= reachM)) covered++;
    }
  }
  return inside === 0 ? 0 : covered / inside;
}

function maxVoidM(m: VillageModel, radiusM: number): number {
  let worst = 0;
  for (let x = -radiusM; x <= radiusM; x += 6) {
    for (let y = -radiusM; y <= radiusM; y += 6) {
      if (Math.hypot(x, y) > radiusM) continue;
      const p = new Point(m.green.centre.x + x, m.green.centre.y + y);
      let nearest = Infinity;
      for (const lane of m.lanes) {
        for (let i = 1; i < lane.points.length; i++) {
          nearest = Math.min(
            nearest, dist(p, closestPointOnSegment(p, lane.points[i - 1], lane.points[i])),
          );
        }
      }
      worst = Math.max(worst, nearest);
    }
  }
  return worst;
}

function lanelessSectorDeg(m: VillageModel, radiusM: number): number {
  const buckets = new Array<boolean>(180).fill(false);
  const mark = (p: Point): void => {
    const d = dist(p, m.green.centre);
    if (d > radiusM || d < 1) return;
    const deg = (Math.atan2(p.x - m.green.centre.x, -(p.y - m.green.centre.y)) * 180) / Math.PI;
    buckets[Math.floor((((deg % 360) + 360) % 360) / 2) % 180] = true;
  };
  for (const lane of m.lanes) {
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1];
      const b = lane.points[i];
      const steps = Math.max(1, Math.ceil(dist(a, b) / 3));
      for (let k = 0; k <= steps; k++) {
        mark(new Point(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps));
      }
    }
  }
  if (buckets.every((c) => !c)) return 360;
  let best = 0;
  for (let i = 0; i < 360; i++) {
    if (buckets[i % 180]) continue;
    let len = 0;
    while (len < 180 && !buckets[(i + len) % 180]) len++;
    best = Math.max(best, len);
    i += len;
  }
  return best * 2;
}

/** Crossings between lane bodies (endpoint touches are junctions, not crossings). */
function crossings(lanes: Lane[]): number {
  let n = 0;
  for (let a = 0; a < lanes.length; a++) {
    for (let b = a + 1; b < lanes.length; b++) {
      for (let i = 1; i < lanes[a].points.length; i++) {
        for (let j = 1; j < lanes[b].points.length; j++) {
          if (segmentIntersection(
            lanes[a].points[i - 1], lanes[a].points[i],
            lanes[b].points[j - 1], lanes[b].points[j],
          )) n++;
        }
      }
    }
  }
  return n;
}

/** Mean distance between junctions along a lane — the block-size proxy. */
function meanJunctionSpacingM(lanes: Lane[]): number {
  const EPS = 1.5;
  let totalLen = 0;
  let junctions = 0;
  for (const lane of lanes) {
    let len = 0;
    for (let i = 1; i < lane.points.length; i++) len += dist(lane.points[i - 1], lane.points[i]);
    totalLen += len;
    for (const other of lanes) {
      if (other.id === lane.id) continue;
      for (const end of [other.points[0], other.points[other.points.length - 1]]) {
        let nearest = Infinity;
        for (let i = 1; i < lane.points.length; i++) {
          nearest = Math.min(
            nearest, dist(end, closestPointOnSegment(end, lane.points[i - 1], lane.points[i])),
          );
        }
        if (nearest <= EPS) junctions++;
      }
    }
  }
  return junctions === 0 ? Infinity : totalLen / junctions;
}

/**
 * Median nearest-ink gap between neighbouring buildings, ink rectangle to
 * ink rectangle (via each OBB's support width along the centre line, which
 * is exact for the axis that separates them).
 */
function inkGapMedianM(m: VillageModel): number {
  const obbs = m.buildings.map(obbOf);
  const support = (o: ReturnType<typeof obbOf>, ux: number, uy: number): number => (
    Math.abs(ux * o.t.x + uy * o.t.y) * o.halfW + Math.abs(ux * o.n.x + uy * o.n.y) * o.halfD
  );
  const gaps: number[] = [];
  for (let i = 0; i < obbs.length; i++) {
    let best = Infinity;
    for (let j = 0; j < obbs.length; j++) {
      if (i === j) continue;
      const dx = obbs[j].c.x - obbs[i].c.x;
      const dy = obbs[j].c.y - obbs[i].c.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) { best = 0; continue; }
      best = Math.min(best, len - support(obbs[i], dx / len, dy / len)
        - support(obbs[j], dx / len, dy / len));
    }
    if (Number.isFinite(best)) gaps.push(Math.max(0, best));
  }
  gaps.sort((a, b) => a - b);
  return gaps.length === 0 ? 0 : gaps[Math.floor(gaps.length / 2)];
}

/**
 * The disc the census asks for, recomputed exactly as `generateVillage`
 * does. `buildDeck` is the first consumer of the village rng, so a fresh
 * SeededRandom(seed) reproduces the same deck.
 */
function closedFormRadiusM(input: AzgaarBurgInput, seed: number): number {
  const rng = new SeededRandom(seed);
  const site = buildSite(input);
  const { entries: deck } = buildDeck(site.biome, site.population, rng);
  const f0 = widestDwellingWidthM(deck) + gapForPopulation(site.population);
  const landmarkLots = deck.filter((e) => e.cap && eligible(e, site, Infinity)).length;
  const dwellings = Math.ceil(site.population / ordinaryOccupancy(deck)) + landmarkLots;
  return discRadiusFor(dwellings, Math.max(f0, minDwellingFrontageM(deck)));
}

process.stdout.write('=== lot fates (final round), per fixture ===\n');
const metricRows: string[] = [];

for (const [pop, seed] of FIXTURES) {
  const trace = newLotTrace();
  const input = fixture(pop);
  const m = generateVillage(input, seed, trace);

  const counts = new Map<LotFate, number>();
  for (const id of trace.cut.keys()) {
    const f = trace.fates.get(id);
    if (!f) continue;
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const total = trace.cut.size;
  const cells = ORDER.map((f) => {
    const n = counts.get(f) ?? 0;
    return `${f} ${n} (${total === 0 ? 0 : Math.round((n / total) * 100)}%)`;
  });
  process.stdout.write(
    `pop=${pop} seed=${seed}: cut ${total} | ${cells.join(' | ')}`
    + ` | [overlay] stale-after-trim ${trace.staleAfterTrim.size}\n`,
  );
  // The dominant cause, opened up: which KIND of convergence killed it.
  const sub = new Map<string, number>();
  for (const [id, why] of trace.convergeDetail) {
    if (trace.fates.get(id) !== 'converging-claim') continue;
    sub.set(why, (sub.get(why) ?? 0) + 1);
  }
  process.stdout.write(`    converging-claim breakdown: ${
    [...sub.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n} (${Math.round((n / total) * 100)}% of cut)`).join(' | ')
  }\n`);

  const fabricR = fabricRadiusM(m);
  const targetR = closedFormRadiusM(input, seed);
  metricRows.push([
    `pop=${pop} s${seed}`,
    `R ${Math.round(fabricR)}`,
    `frontage-housed ${Math.round(frontageHoused(trace.cut, trace.fates) * 100)}%`,
    `landuse@6 centre ${Math.round(landUseFromCentre(m, fabricR, 6) * 100)}%`,
    `ink ${Math.round(landUse(m, fabricR, 6) * 100)}%`,
    `void ${Math.round(maxVoidM(m, fabricR))}/${VOID_SPACING_M}`,
    `sector ${lanelessSectorDeg(m, fabricR)}deg`,
    `lanes ${m.lanes.length}`,
    `cross ${crossings(m.lanes)}`,
    `junction-pitch ${Math.round(meanJunctionSpacingM(m.lanes))}m`,
    `inkgap ${inkGapMedianM(m).toFixed(2)}`,
    `housed ${m.buildings.reduce((s, b) => s + b.occupancy, 0)}/${pop}`,
    `closedform ${Math.round(targetR)}`,
  ].join(' | '));
}

process.stdout.write('\n=== acceptance metrics ===\n');
for (const row of metricRows) process.stdout.write(`${row}\n`);
process.exit(0);
