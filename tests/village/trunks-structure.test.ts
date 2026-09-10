/**
 * Task 4b structural invariants for the trunk network (spec 2026-08-25 §5.6).
 *
 * These are the bars the 2026-09-05 fresh-eye + multi-agent reviews found
 * nothing was enforcing: every one of them fails against the pre-4b
 * synthesizer on at least one scenario in the matrix below. They run over
 * the whole AFMG scenario set rather than a single fixture, because every
 * defect they catch was scenario- or seed-dependent (a lone road, a
 * route-less site, a trail-only village, a wet site).
 */
import { describe, expect, it } from 'vitest';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { AIM_CLEAR_RADIUS_M } from '../../src/village/constants.js';
import { closestPointOnPolyline, dist, inAnyWater } from '../../src/village/geometry.js';
import { classRank, laneWidth } from '../../src/village/route-class.js';
import { waterPushedCentre } from '../../src/village/skeleton/green-siting.js';
import {
  isTrunk, synthesizeTrunks, type TrunkNetwork,
} from '../../src/village/skeleton/trunks.js';
import type { Lane, Site, SiteRoute } from '../../src/village/types.js';
import { generateVillage } from '../../src/village/village-model.js';

const BUILT_EDGE = 55;
const CONTRACT = BUILT_EDGE * 2.75;
/** The weld tolerance `blockAreas` uses: a junction is an endpoint within this. */
const WELD_M = 1.5;

const site = (routes: SiteRoute[], water: Point[][] = []): Site => ({
  population: 300, biome: 'temperate', routes, water,
  flags: { port: false, temple: false, trade: false, walls: false },
} as Site);

const r = (
  bearingDeg: number, type: SiteRoute['type'], through = false, routeId?: string,
): SiteRoute => ({ bearingDeg, type, through, routeId } as SiteRoute);

/** The AFMG scenario matrix these bars run over. */
const SCENARIOS: Array<{ name: string; routes: SiteRoute[]; }> = [
  { name: 'lone terminating main', routes: [r(225, 'main', false, 'a')] },
  { name: 'lone through town', routes: [r(40, 'town', true, 'a')] },
  { name: 'two terminating', routes: [r(90, 'main', false, 'a'), r(210, 'town', false, 'b')] },
  { name: 'tri', routes: [r(40, 'main', true, 'r-main'), r(165, 'town', false, 'r-town'), r(290, 'trail', false, 'r-trail')] },
  { name: 'hub', routes: [r(12, 'royal', true, 'r-royal'), r(78, 'main', false, 'r-main'), r(155, 'town', false, 'r-town'), r(231, 'trail', false, 'r-trail'), r(304, 'footpath', false, 'r-foot')] },
  { name: 'fan', routes: [r(90.0, 'main', false, 'a'), r(90.5, 'main', false, 'b'), r(91.2, 'town', false, 'c'), r(130, 'local', false, 'd'), r(170, 'trail', false, 'e'), r(210, 'footpath', false, 'f'), r(250, 'main', true, 'g'), r(330, 'royal', false, 'h')] },
  { name: 'through main with a close feeder', routes: [r(90, 'main', true, 'a'), r(93, 'local', false, 'b')] },
  { name: 'trail-fed hamlet', routes: [r(200, 'trail', false, 'a'), r(60, 'footpath', false, 'b')] },
];

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34];

function networks(routes: SiteRoute[]): Array<{ seed: number; net: TrunkNetwork; }> {
  return SEEDS.map((seed) => ({
    seed, net: synthesizeTrunks(site(routes), CONTRACT, BUILT_EDGE, new SeededRandom(seed)),
  }));
}

/** Turn angle at vertex `k` of a polyline, in degrees. */
function turnAt(points: Point[], k: number): number {
  const a = points[k - 1]; const b = points[k]; const c = points[k + 1];
  const v1 = Math.atan2(b.y - a.y, b.x - a.x);
  const v2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs((v2 - v1) * 180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

/** How close `p` comes to any lane other than `self`. */
function nearestOther(p: Point, lanes: Lane[], selfId: string): number {
  let best = Infinity;
  for (const o of lanes) {
    if (o.id === selfId || o.points.length < 2) continue;
    const d = closestPointOnPolyline(p, o.points).distance;
    if (d < best) best = d;
  }
  return best;
}

describe('trunk network structural invariants (task 4b)', () => {
  it('every trunk has at least two points — no route collapses to a dot', () => {
    for (const { name, routes } of SCENARIOS) {
      for (const { seed, net } of networks(routes)) {
        for (const t of net.trunks) {
          expect(t.points.length,
            `${name} seed ${seed}: ${t.id} has ${t.points.length} point(s)`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('every trunk id is unique — lot and building ids derive from them (R-series)', () => {
    for (const { name, routes } of SCENARIOS) {
      for (const { seed, net } of networks(routes)) {
        const ids = net.trunks.map((t) => t.id);
        expect(new Set(ids).size, `${name} seed ${seed}: ids ${JSON.stringify(ids)}`).toBe(ids.length);
      }
    }
    // The collision the deleted `buildArms` guard used to catch: two id-less
    // routes of one class whose bearings round to the same 2 dp key.
    const collide = synthesizeTrunks(
      site([r(90, 'main'), r(90.001, 'main')]), CONTRACT, BUILT_EDGE, new SeededRandom(1),
    );
    const ids = collide.trunks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the network is one connected road system, not islands', () => {
    // Stated as connectedness rather than "every inner end welds onto
    // something": a `main-street` spine legitimately has BOTH ends on the
    // contract circle (it runs through the village, it does not terminate
    // in it), and a village served by one such road is a perfectly
    // connected network of exactly one lane. What must never happen is a
    // lane stranded off the system -- which is what `blockAreas` sees as a
    // face that never closes, and what a reader sees as a road to nowhere.
    for (const { name, routes } of SCENARIOS) {
      for (const { seed, net } of networks(routes)) {
        const lanes = net.trunks.filter((t) => t.points.length >= 2);
        if (lanes.length <= 1) continue;
        const touches = (a: Lane, b: Lane): boolean => {
          for (const end of [a.points[0], a.points[a.points.length - 1]]) {
            if (closestPointOnPolyline(end, b.points).distance <= WELD_M) return true;
          }
          for (const end of [b.points[0], b.points[b.points.length - 1]]) {
            if (closestPointOnPolyline(end, a.points).distance <= WELD_M) return true;
          }
          return false;
        };
        const seen = new Set<string>([lanes[0].id]);
        const queue = [lanes[0]];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          for (const other of lanes) {
            if (seen.has(other.id) || !touches(cur, other)) continue;
            seen.add(other.id);
            queue.push(other);
          }
        }
        const stranded = lanes.filter((l) => !seen.has(l.id)).map((l) => l.id);
        expect(stranded, `${name} seed ${seed}: stranded off the network`).toEqual([]);
      }
    }
  });

  it('every supplied approach reaches its measured entry, with no invented exits', () => {
    for (const { routes } of SCENARIOS) for (const { net } of networks(routes)) {
      expect(net.entries).toHaveLength(routes.length);
      for (const entry of net.entries) {
        expect(Math.min(...net.trunks.map(t => closestPointOnPolyline(entry.point, t.points).distance))).toBeLessThan(1e-6);
      }
    }
  });

  it('no trunk doubles back on itself — no vertex turns more than 45 degrees', () => {
    for (const { name, routes } of SCENARIOS) {
      for (const { seed, net } of networks(routes)) {
        for (const t of net.trunks) {
          for (let k = 1; k + 1 < t.points.length; k++) {
            expect(turnAt(t.points, k),
              `${name} seed ${seed}: ${t.id} turns hard at vertex ${k}`).toBeLessThanOrEqual(45);
          }
        }
      }
    }
  });

  it('no two trunks run near-parallel for a meaningful distance', () => {
    for (const { name, routes } of SCENARIOS) {
      for (const { seed, net } of networks(routes)) {
        for (let i = 0; i < net.trunks.length; i++) {
          for (let j = i + 1; j < net.trunks.length; j++) {
            const a = net.trunks[i]; const b = net.trunks[j];
            if (a.points.length < 2 || b.points.length < 2) continue;
            // Roads that actually MEET are exempt: a lesser road merging
            // into a greater one approaches it tangentially and runs
            // alongside for a stretch before the junction, which is what a
            // real merge looks like. The defect this bar exists for is two
            // roads that shadow each other and never join at all -- the
            // AFMG `fan` fixture's two `main` routes half a degree apart,
            // measured at 73 m of parallel road in every seed.
            const joined = [a.points[0], a.points[a.points.length - 1]]
              .some((e) => closestPointOnPolyline(e, b.points).distance <= WELD_M)
              || [b.points[0], b.points[b.points.length - 1]]
                .some((e) => closestPointOnPolyline(e, a.points).distance <= WELD_M);
            if (joined) continue;
            let close = 0;
            for (let k = 1; k < a.points.length; k++) {
              const d = closestPointOnPolyline(a.points[k], b.points).distance;
              if (d > 1e-6 && d < 4) close += dist(a.points[k - 1], a.points[k]);
            }
            expect(close, `${name} seed ${seed}: ${a.id} shadows ${b.id}`).toBeLessThan(20);
          }
        }
      }
    }
  });

  it('is independent of the order FMG lists the routes in', () => {
    for (const { name, routes } of SCENARIOS) {
      if (routes.length < 2) continue;
      for (const seed of SEEDS) {
        const forward = synthesizeTrunks(site(routes), CONTRACT, BUILT_EDGE, new SeededRandom(seed));
        const reversed = synthesizeTrunks(
          site([...routes].reverse()), CONTRACT, BUILT_EDGE, new SeededRandom(seed),
        );
        const key = (n: TrunkNetwork) => JSON.stringify(
          n.trunks.map((t) => [t.id, t.points.map((p) => [+p.x.toFixed(6), +p.y.toFixed(6)])])
            .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
        );
        expect(key(forward), `${name} seed ${seed}`).toBe(key(reversed));
      }
    }
  });

  it('invents no lane wider than the roads that feed it', () => {
    for (const { name, routes } of SCENARIOS) {
      const widest = Math.min(...routes.map((x) => classRank(x.type)));
      const widestWidth = laneWidth(routes.reduce((a, b) => (classRank(a.type) <= classRank(b.type) ? a : b)).type);
      expect(widest).toBeGreaterThanOrEqual(0);
      for (const { seed, net } of networks(routes)) {
        for (const t of net.trunks) {
          expect(t.widthM,
            `${name} seed ${seed}: ${t.id} (${t.type}) is wider than the best feeder`).toBeLessThanOrEqual(widestWidth);
        }
      }
    }
  });

  it('invents nothing at all for a village with no roads', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const net = synthesizeTrunks(site([]), CONTRACT, BUILT_EDGE, new SeededRandom(seed));
      expect(net.trunks, `seed ${seed} invented lanes from no routes`).toHaveLength(0);
    }
  });

  it('never purchases a ring merely because several approaches arrive', () => {
    for (const { routes } of SCENARIOS) for (const { net } of networks(routes)) {
      expect(net.ring).toEqual([]);
      expect(net.trunks.some(l => l.id.startsWith('trunk-loop-'))).toBe(false);
    }
  });

  it('records no junction where no road actually is', () => {
    // Visible as stray marks inside the ring in `trunks-tri-300-s2.png`:
    // `mergeTrunks` records a junction where a lesser trunk captured onto a
    // greater one, and pattern application then moves or truncates that
    // geometry -- leaving the record pointing at open ground. Harmless to
    // the drawing today, but Task 10 exports these as the network's
    // junctions, so a phantom would ship as data.
    for (const { name, routes } of SCENARIOS) {
      for (const { seed, net } of networks(routes)) {
        for (const j of net.junctions) {
          const onSomeLane = net.trunks.some(
            (t) => t.points.length >= 2
              && closestPointOnPolyline(j.position, t.points).distance <= WELD_M,
          );
          expect(onSomeLane,
            `${name} seed ${seed}: junction ${j.id} sits on no road`).toBe(true);
          for (const id of j.laneIds) {
            expect(net.trunks.some((t) => t.id === id),
              `${name} seed ${seed}: junction ${j.id} names a lane that is gone`).toBe(true);
          }
        }
      }
    }
  });

  it('converges on dry ground, and the green it serves sits there too', () => {
    // A half-plane sea whose edge cuts across the burg origin. The aim is
    // the CALLER's contract (`village-model` computes it and hands the same
    // point to the network and to `siteGreen`), so it is asserted here the
    // way the pipeline actually builds it, and then end-to-end.
    const edgeY = -5;
    const water: Point[][] = [[
      new Point(-600, edgeY), new Point(600, edgeY), new Point(600, 600), new Point(-600, 600),
    ]];
    const wet = site([r(270, 'main', false, 'a'), r(200, 'town', false, 'b')], water);
    expect(inAnyWater(new Point(0, 0), water), 'fixture should drown the origin').toBe(true);

    const aim = waterPushedCentre(new Point(0, 0), AIM_CLEAR_RADIUS_M, water).centre;
    expect(inAnyWater(aim, water), 'the aim is still in the sea').toBe(false);

    const net = synthesizeTrunks(wet, CONTRACT, BUILT_EDGE, new SeededRandom(1), aim);
    expect(inAnyWater(net.aim, water)).toBe(false);
    expect(dist(net.aim, aim)).toBeLessThan(20);

    const input: AzgaarBurgInput = {
      name: 'Port', population: 300, port: true, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [
        { bearing_deg: 270, kind: 'main' }, { bearing_deg: 200, kind: 'town' },
      ],
      coastlineGeometry: [[
        { x: -600, y: edgeY }, { x: 600, y: edgeY }, { x: 600, y: 600 }, { x: -600, y: 600 },
      ]],
    } as AzgaarBurgInput;
    const m = generateVillage(input, 1);
    const trunks = m.lanes.filter((l) => isTrunk(l.id) && l.points.length >= 2);
    expect(trunks.length).toBeGreaterThan(0);
    // The defect this pins: the green was pushed clear of the water while
    // the roads kept converging on the drowned origin, up to 34 m away.
    const reach = Math.min(...trunks.map(
      (t) => closestPointOnPolyline(m.green.centre, t.points).distance,
    ));
    expect(reach, 'no road reaches the green the village was pushed to').toBeLessThan(m.green.diameter);
  });
});
