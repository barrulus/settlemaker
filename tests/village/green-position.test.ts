import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { siteGreen, waterClips } from '../../src/village/skeleton/green-siting.js';
import type { Site, SiteRoute } from '../../src/village/types.js';

const route = (bearingDeg: number, type: SiteRoute['type'], through = false): SiteRoute =>
  ({ bearingDeg, type, through });

const site = (routes: SiteRoute[], water: Point[][] = []): Site =>
  ({ population: 300, biome: 'temperate', routes, water,
     flags: { port: false, temple: false, trade: false, walls: false } });

// A square of water covering everything north of y = 5.
// (R3: widened from y <= -20 so the case under test genuinely clips —
// the green's probe rim only reaches y = -17 for that case, which the
// original -20 boundary never touches.)
const northWater = [[
  new Point(-500, -500), new Point(500, -500), new Point(500, 5), new Point(-500, 5),
]];

// A square of water covering everything east of x = 5.
const eastWater = [[
  new Point(5, -500), new Point(500, -500), new Point(500, 500), new Point(5, 500),
]];

describe('waterClips', () => {
  it('is true when the green would reach into water', () => {
    expect(waterClips(new Point(0, 0), 30, northWater)).toBe(true);
  });
  it('is false when it clears', () => {
    expect(waterClips(new Point(0, 100), 10, northWater)).toBe(false);
  });
});

describe('siteGreen', () => {
  it('sits on the origin when a single route terminates there', () => {
    const g = siteGreen(site([route(225, 'main')]), 100, new SeededRandom(1));
    expect(g.centre.x).toBeCloseTo(0, 5);
    expect(g.centre.y).toBeCloseTo(0, 5);
    expect(g.shape).toBe('sm-green-round');
  });

  it('takes its long-axis bearing from a through route', () => {
    const g = siteGreen(site([route(90, 'main', true)]), 100, new SeededRandom(1));
    expect(g.bearingDeg).toBeCloseTo(90, 5);
    expect(g.shape).toBe('sm-green-lens-long');
  });

  it('pushes away from water until it clears, plus margin', () => {
    const g = siteGreen(site([route(180, 'main')], northWater), 100, new SeededRandom(1));
    // Water fills y <= 5 (north is -y). The green must sit south of it.
    expect(g.centre.y).toBeGreaterThan(5);
    expect(waterClips(g.centre, g.diameter / 2, northWater)).toBe(false);
    expect(g.shape).toBe('sm-green-d');
  });

  it('pushes south when water is north even if the arm points straight into it (R9)', () => {
    // The single arm bears due north (0deg) — straight into the water.
    // A push that followed the arm's bearing would walk further into the
    // water for all 200 steps and give up still wet. The push must instead
    // read the water itself and go the other way.
    const g = siteGreen(site([route(0, 'main')], northWater), 100, new SeededRandom(1));
    expect(g.centre.y).toBeGreaterThan(5);
    expect(waterClips(g.centre, g.diameter / 2, northWater)).toBe(false);
    expect(g.shape).toBe('sm-green-d');
  });

  it('pushes west when water is east (not hardcoded to a north/south axis)', () => {
    const g = siteGreen(site([route(180, 'main')], eastWater), 100, new SeededRandom(1));
    expect(g.centre.x).toBeLessThan(5);
    expect(waterClips(g.centre, g.diameter / 2, eastWater)).toBe(false);
    expect(g.shape).toBe('sm-green-d');
  });

  it('picks a seed variant deterministically', () => {
    const a = siteGreen(site([route(0, 'main')]), 100, new SeededRandom(42));
    const b = siteGreen(site([route(0, 'main')]), 100, new SeededRandom(42));
    expect(a.variant).toBe(b.variant);
    expect(['a', 'b']).toContain(a.variant);
  });
});
