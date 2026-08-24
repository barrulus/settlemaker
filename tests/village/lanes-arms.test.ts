import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { buildArms } from '../../src/village/skeleton/lanes.js';
import { GREEN_UNDERLAP_RATIO } from '../../src/village/constants.js';
import type { Green, Site, SiteRoute } from '../../src/village/types.js';

const route = (bearingDeg: number, type: SiteRoute['type'], through = false): SiteRoute =>
  ({ bearingDeg, type, through });

const site = (routes: SiteRoute[]): Site =>
  ({ population: 300, biome: 'temperate', routes, water: [],
     flags: { port: false, temple: false, trade: false, walls: false } });

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

describe('buildArms', () => {
  it('makes one lane per terminating route, starting at the green rim', () => {
    const lanes = buildArms(site([route(90, 'main')]), green, 150, new SeededRandom(1));
    expect(lanes).toHaveLength(1);
    expect(lanes[0].id).toBe('arm-090');
    expect(lanes[0].type).toBe('main');
    expect(lanes[0].widthM).toBe(5);
    // starts on the rim, not at the centre
    const start = lanes[0].points[0];
    // Gate-2 junction rule: roads go UNDER the green. Arms start deep in
    // its interior (radius x GREEN_UNDERLAP_RATIO) and the green paints
    // over them, so each road visibly disappears beneath the turf.
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(10 * GREEN_UNDERLAP_RATIO, 1);
  });

  it('makes two lanes for a through route — it enters and it leaves', () => {
    const lanes = buildArms(site([route(90, 'main', true)]), green, 150, new SeededRandom(1));
    expect(lanes.map((l) => l.id).sort()).toEqual(['arm-090', 'arm-270']);
    expect(lanes.every((l) => l.type === 'main')).toBe(true);
  });

  it('runs each arm out to the extent', () => {
    const lanes = buildArms(site([route(0, 'town')]), green, 200, new SeededRandom(1));
    const end = lanes[0].points[lanes[0].points.length - 1];
    expect(Math.hypot(end.x, end.y)).toBeGreaterThan(150);
  });

  it('wanders, but is deterministic for a seed', () => {
    const a = buildArms(site([route(0, 'town')]), green, 200, new SeededRandom(7));
    const b = buildArms(site([route(0, 'town')]), green, 200, new SeededRandom(7));
    expect(a[0].points.map((p) => [p.x, p.y])).toEqual(b[0].points.map((p) => [p.x, p.y]));
    // not a perfectly straight line
    const xs = a[0].points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
  });

  it('keeps trails and footpaths as arms too — they just did not site the green', () => {
    const lanes = buildArms(site([route(45, 'footpath')]), green, 150, new SeededRandom(1));
    expect(lanes[0].type).toBe('footpath');
    expect(lanes[0].widthM).toBe(1.2);
  });

  it('starts every arm on the rim (R4): the first point is not drifted', () => {
    // A seed sequence chosen so the first drift draw is non-trivial; if the
    // implementation accumulated drift before pushing the first point (the
    // brief's original bug), this would fail on most seeds, not just one.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const lanes = buildArms(site([route(0, 'town')]), green, 150, new SeededRandom(seed));
      const start = lanes[0].points[0];
      // Gate-2 junction rule: roads go UNDER the green. Arms start deep in
    // its interior (radius x GREEN_UNDERLAP_RATIO) and the green paints
    // over them, so each road visibly disappears beneath the turf.
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(10 * GREEN_UNDERLAP_RATIO, 1);
    }
  });

  describe('near-duplicate bearing merge (task 3)', () => {
    it('collapses fan\'s 90.0/90.5/91.2 trio into one arm', () => {
      const lanes = buildArms(site([
        { bearingDeg: 90.0, type: 'main', through: false, routeId: 'a' },
        { bearingDeg: 90.5, type: 'main', through: false, routeId: 'b' },
        { bearingDeg: 91.2, type: 'town', through: false, routeId: 'c' },
      ]), green, 150, new SeededRandom(1));
      expect(lanes).toHaveLength(1);
      expect(lanes[0].id).toBe('arm-090');
    });

    it('leaves fan\'s real 38.8-degree gap alone — two arms, not one', () => {
      const lanes = buildArms(site([
        { bearingDeg: 91.2, type: 'town', through: false, routeId: 'c' },
        { bearingDeg: 130, type: 'local', through: false, routeId: 'd' },
      ]), green, 150, new SeededRandom(1));
      expect(lanes).toHaveLength(2);
    });

    it('the merged arm takes the highest route class present, never a demotion', () => {
      const lanes = buildArms(site([
        { bearingDeg: 10.0, type: 'trail', through: false, routeId: 'x' },
        { bearingDeg: 10.3, type: 'main', through: false, routeId: 'y' },
      ]), green, 150, new SeededRandom(1));
      expect(lanes).toHaveLength(1);
      expect(lanes[0].type).toBe('main');
      expect(lanes[0].widthM).toBe(5);
    });

    it('ties within a class break lexically on route id, deterministically', () => {
      const lanes = buildArms(site([
        { bearingDeg: 90.5, type: 'main', through: false, routeId: 'b' },
        { bearingDeg: 90.0, type: 'main', through: false, routeId: 'a' },
      ]), green, 150, new SeededRandom(1));
      expect(lanes).toHaveLength(1);
      expect(lanes[0].sourceRouteIds).toEqual(['a', 'b']);
    });

    it('a through route in the cluster makes the merged arm through — near and far side', () => {
      const lanes = buildArms(site([
        { bearingDeg: 10.0, type: 'main', through: false, routeId: 'x' },
        { bearingDeg: 10.3, type: 'trail', through: true, routeId: 'y' },
      ]), green, 150, new SeededRandom(1));
      expect(lanes.map((l) => l.id).sort()).toEqual(['arm-010', 'arm-190']);
      expect(lanes.every((l) => l.type === 'main')).toBe(true);
    });

    it('is order-independent — same cluster, shuffled input, same result', () => {
      const routes: SiteRoute[] = [
        { bearingDeg: 90.0, type: 'main', through: false, routeId: 'a' },
        { bearingDeg: 90.5, type: 'main', through: false, routeId: 'b' },
        { bearingDeg: 91.2, type: 'town', through: false, routeId: 'c' },
      ];
      const forward = buildArms(site(routes), green, 150, new SeededRandom(1));
      const reversed = buildArms(site([...routes].reverse()), green, 150, new SeededRandom(1));
      expect(forward.map((l) => l.id)).toEqual(reversed.map((l) => l.id));
      expect(forward.map((l) => l.type)).toEqual(reversed.map((l) => l.type));
    });

    it('records which routes fed a merged arm, but leaves a solo arm unmarked', () => {
      const merged = buildArms(site([
        { bearingDeg: 90.0, type: 'main', through: false, routeId: 'a' },
        { bearingDeg: 90.5, type: 'main', through: false, routeId: 'b' },
      ]), green, 150, new SeededRandom(1));
      expect(merged[0].sourceRouteIds).toEqual(['a', 'b']);

      const solo = buildArms(site([
        { bearingDeg: 90.0, type: 'main', through: false, routeId: 'a' },
      ]), green, 150, new SeededRandom(1));
      expect(solo[0].sourceRouteIds).toBeUndefined();
    });

    it('merges across the 0/360 wrap, same as anywhere else on the circle', () => {
      const lanes = buildArms(site([
        { bearingDeg: 358, type: 'main', through: false, routeId: 'a' },
        { bearingDeg: 2, type: 'main', through: false, routeId: 'b' },
      ]), green, 150, new SeededRandom(1));
      expect(lanes).toHaveLength(1);
      expect(lanes[0].sourceRouteIds).toEqual(['a', 'b']);
    });
  });
});
