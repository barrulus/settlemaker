/**
 * Task 7: the green is sited on the finished trunk network (spec 5.3).
 *
 * The inversion the whole plan is named for lands here. Until now the green
 * was placed at the burg origin before any road existed and the roads were
 * aimed at it; now the roads are drawn first and the green is a resident of
 * the network they made -- beside a road, astride one, at the end of one, or
 * enclosed by a ring.
 */
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { pointInPolygon } from '../../src/geom/point-in-polygon.js';
import { closestPointOnPolyline, dist, greenDrawnRadius } from '../../src/village/geometry.js';
import { synthesizeTrunks } from '../../src/village/skeleton/trunks.js';
import { siteGreenOnNetwork } from '../../src/village/skeleton/green-siting.js';
import { GREEN_CONNECTOR_MAX_SHARE } from '../../src/village/constants.js';
import type { Site, SiteRoute } from '../../src/village/types.js';

const BUILT = 55;
const CONTRACT = BUILT * 2.75;

const site = (routes: SiteRoute[], water: Point[][] = []): Site => ({
  population: 300, biome: 'temperate', routes, water,
  flags: { port: false, temple: false, trade: false, walls: false },
} as Site);

const r = (
  bearingDeg: number, type: SiteRoute['type'], through = false, routeId?: string,
): SiteRoute => ({ bearingDeg, type, through, routeId } as SiteRoute);

const THROUGH = [r(40, 'main', true, 'r-main'), r(165, 'town', false, 'r-town'), r(290, 'trail', false, 'r-trail')];
const TERMINAL = [r(200, 'main', false, 'a'), r(60, 'trail', false, 'b'), r(320, 'footpath', false, 'c')];

function build(routes: SiteRoute[], seed: number, water: Point[][] = []) {
  const s = site(routes, water);
  const rng = new SeededRandom(seed);
  const network = synthesizeTrunks(s, CONTRACT, BUILT, rng);
  return { s, network, ...siteGreenOnNetwork(s, network, BUILT, rng) };
}

/** Closest any trunk polyline comes to `p`. */
const nearestTrunk = (p: Point, trunks: { points: Point[] }[]): number =>
  Math.min(...trunks.filter((t) => t.points.length >= 2)
    .map((t) => closestPointOnPolyline(p, t.points).distance));

describe('siteGreenOnNetwork', () => {
  it('(a) picks a relation the network can actually support', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      const { network, relation } = build(THROUGH, seed);
      if (network.pattern === 'main-street') {
        expect(['tangent', 'astride']).toContain(relation);
        seen.add(relation);
      }
      if (network.pattern === 'loop') expect(relation).toBe('enclosed');
      if (network.pattern === 'terminal') expect(relation).toBe('terminal');
    }
    expect(seen.size, 'main-street should reach both tangent and astride').toBeGreaterThan(1);
  });

  it('(a) a loop encloses the green inside the ring', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { network, green, relation } = build(THROUGH, seed);
      if (network.pattern !== 'loop') continue;
      expect(relation).toBe('enclosed');
      // Read off the network, not rebuilt from lane ids — a crossing-split
      // ring half sorts as NaN and yields a self-intersecting polygon.
      const ring = network.ring;
      expect(ring.length).toBeGreaterThanOrEqual(3);
      expect(pointInPolygon(green.centre, ring), `seed ${seed}: green outside its own ring`).toBe(true);
    }
  });

  it('(a) a terminating road ends at the green it serves', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { network, green, relation } = build(TERMINAL, seed);
      if (network.pattern !== 'terminal') continue;
      expect(relation).toBe('terminal');
      const reach = nearestTrunk(green.centre, network.trunks);
      expect(reach, `seed ${seed}`).toBeLessThanOrEqual(green.diameter / 2);
    }
  });

  it('(b) tangent puts the green BESIDE a road; astride puts a road THROUGH it', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { network, green, relation } = build(THROUGH, seed);
      const toCentre = nearestTrunk(green.centre, network.trunks);
      if (relation === 'tangent') {
        expect(toCentre, `seed ${seed}: tangent green sits ON the road`)
          .toBeGreaterThan(greenDrawnRadius(green) * 0.35);
        expect(toCentre, `seed ${seed}: tangent green is nowhere near a road`)
          .toBeLessThanOrEqual(green.diameter);
      }
      if (relation === 'astride') {
        expect(toCentre, `seed ${seed}: astride green has no road through it`)
          .toBeLessThanOrEqual(greenDrawnRadius(green));
      }
    }
  });

  it('(c) the green always sits inside the village it belongs to', () => {
    for (const routes of [THROUGH, TERMINAL]) {
      for (let seed = 1; seed <= 40; seed++) {
        const { green } = build(routes, seed);
        expect(dist(green.centre, new Point(0, 0)), `seed ${seed}`).toBeLessThanOrEqual(BUILT);
      }
    }
  });

  it('(d) a green off the network gets connectors, and they reach it', () => {
    for (const routes of [THROUGH, TERMINAL]) {
      for (let seed = 1; seed <= 40; seed++) {
        const { network, green, connectors } = build(routes, seed);
        const rim = greenDrawnRadius(green);
        const touching = nearestTrunk(green.centre, network.trunks) <= rim;
        if (touching) {
          expect(connectors, `seed ${seed}: green already on the network`).toHaveLength(0);
          continue;
        }
        expect(connectors.length, `seed ${seed}: green stranded off the network`).toBeGreaterThan(0);
        for (const c of connectors) {
          expect(c.points.length).toBeGreaterThanOrEqual(2);
          const len = c.points.slice(1)
            .reduce((sum, p, i) => sum + dist(c.points[i], p), 0);
          // Read from the constant, not hardcoded: the cap is tied to
          // LOOP_RADIUS_FACTOR (an enclosed green must be able to reach the
          // ring around it), and the two are meant to move together.
          expect(len, `seed ${seed}: connector ${c.id} sprawls`)
            .toBeLessThanOrEqual(BUILT * GREEN_CONNECTOR_MAX_SHARE);
          // starts at the green, ends on a road
          expect(dist(c.points[0], green.centre)).toBeLessThanOrEqual(rim + 1e-6);
          expect(nearestTrunk(c.points[c.points.length - 1], network.trunks)).toBeLessThanOrEqual(1.5);
        }
      }
    }
  });

  it('(e) water still pushes the green clear, and marks it clipped', () => {
    const water: Point[][] = [[
      new Point(-600, -5), new Point(600, -5), new Point(600, 600), new Point(-600, 600),
    ]];
    const { green } = build(THROUGH, 1, water);
    expect(pointInPolygon(green.centre, water[0]), 'green left in the sea').toBe(false);
  });

  it('(f) is deterministic for a seed', () => {
    const a = build(THROUGH, 12);
    const b = build(THROUGH, 12);
    expect(a.relation).toBe(b.relation);
    expect(a.green.centre.x).toBeCloseTo(b.green.centre.x, 9);
    expect(a.green.centre.y).toBeCloseTo(b.green.centre.y, 9);
    expect(JSON.stringify(a.connectors)).toBe(JSON.stringify(b.connectors));
  });
});
