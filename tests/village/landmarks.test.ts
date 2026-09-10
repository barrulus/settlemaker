import { describe, expect, it, vi } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { siteLandmarks } from '../../src/village/skeleton/landmarks.js';
import { greenDrawnRadius } from '../../src/village/geometry.js';
import { lotObb, obbOverlap } from '../../src/village/parcels/overlap.js';
import { nominalFootprint } from '../../src/village/glyphs.js';
import { MAX_LOT_FRONTAGE_RATIO } from '../../src/village/constants.js';
import type { Green, Lane, Site } from '../../src/village/types.js';

const site = (over: Partial<Site> = {}): Site => ({
  population: 400,
  biome: 'temperate',
  routes: [],
  water: [],
  flags: { port: false, temple: false, trade: false, walls: false },
  ...over,
});

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

/** A straight trunk lane running due east from just outside the green out
 * to `len` metres, matching the fixture convention `tests/village/pois.test.ts`
 * uses. */
const lane = (id: string, bearingDeg: number, len = 150, over: Partial<Lane> = {}): Lane => {
  const r = (bearingDeg * Math.PI) / 180;
  const dir = new Point(Math.sin(r), -Math.cos(r));
  return {
    id, type: 'local', widthM: 3.5,
    points: [new Point(dir.x * 11, dir.y * 11), new Point(dir.x * len, dir.y * len)],
    ...over,
  };
};

// A pop-400 temperate village earns all three landmarks (faith minPop 300,
// inn minPop 180, manor minPop 250) and a built radius wide enough that
// every kind's band [0.4, 1.2] / [0.6, 1.6] / [0.9, 2.0] has room on a
// 150 m trunk.
const builtRadiusM = 60;

describe('siteLandmarks', () => {
  it('fronts its lane at the setback and faces it', () => {
    const trunks = [lane('trunk-local-1', 90)];
    const rng = new SeededRandom(1);
    const { landmarks, diagnostics } = siteLandmarks(site(), green, trunks, builtRadiusM, rng);

    expect(diagnostics).toEqual([]);
    expect(landmarks.length).toBeGreaterThan(0);
    for (const lm of landmarks) {
      expect(lm.lot.laneId).toBe('trunk-local-1');
      // The claim's front sits `widthM/2 + setback` off the lane's own
      // (unoffset) centreline -- perpendicular distance to the straight
      // east-running lane is just the |y| component here.
      const setback = 3.5 / 2 + 1; // local lane: LANE_SETBACK_M.local = 1
      expect(Math.abs(lm.lot.front.y)).toBeCloseTo(setback, 5);
      // bearingDeg is the inward normal -- it must point back at the lane,
      // i.e. roughly opposite the outward offset direction (north or south
      // depending on which side won).
      const facesNorth = Math.abs(lm.lot.bearingDeg - 0) < 1;
      const facesSouth = Math.abs(lm.lot.bearingDeg - 180) < 1;
      expect(facesNorth || facesSouth).toBe(true);
    }
  });

  it('mints a claim wider than the ordinary lot cap -- the whole point', () => {
    const trunks = [lane('trunk-local-1', 90)];
    const rng = new SeededRandom(2);
    const { landmarks } = siteLandmarks(site(), green, trunks, builtRadiusM, rng);
    const inn = landmarks.find((l) => l.kind === 'inn');
    expect(inn).toBeDefined();
    const [innWidth] = nominalFootprint('sm-inn');
    expect(innWidth).toBe(17);
    // The widest village dwelling is ~8.6 m; the ordinary cutter's cap is
    // widestDwelling x MAX_LOT_FRONTAGE_RATIO (2) ~= 17.2 m at the very
    // most generous, and inn's 17 m frontage is minted regardless of any
    // such cap -- this function never consults it at all.
    expect(inn!.lot.frontageM).toBe(innWidth);
    expect(inn!.lot.frontageM).toBeGreaterThan(8.6 * MAX_LOT_FRONTAGE_RATIO * 0.9);
  });

  it('respects each kind\'s radial band from the green', () => {
    const trunks = [lane('trunk-local-1', 90)];
    const rng = new SeededRandom(3);
    const built = 60;
    const { landmarks } = siteLandmarks(site(), green, trunks, built, rng);
    for (const lm of landmarks) {
      const d = Math.hypot(lm.lot.front.x - green.centre.x, lm.lot.front.y - green.centre.y);
      const [lo, hi] = { faith: [0, 0.8], inn: [0, 1.1], manor: [0.9, 2.0] }[lm.kind];
      expect(d).toBeGreaterThanOrEqual(lo * built - 1e-6);
      expect(d).toBeLessThanOrEqual(hi * built + 1e-6);
    }
  });

  it('puts an inn on a regional road even when a back lane sorts first', () => {
    const roads = [lane('a-back-lane', 270), lane('trunk-main-0', 90, 150, { type: 'main', widthM: 6 })];
    const { landmarks } = siteLandmarks(site(), green, roads, builtRadiusM, new SeededRandom(1));
    expect(landmarks.find(l => l.kind === 'inn')!.lot.laneId).toBe('trunk-main-0');
    const faith = landmarks.find(l => l.kind === 'faith')!;
    expect(Math.hypot(faith.lot.front.x, faith.lot.front.y)).toBeLessThan(builtRadiusM * 0.5);
  });

  it('refuses a candidate outside every kind\'s band (lane too short)', () => {
    // A trunk that never reaches even the faith band's inner edge
    // (0.4 x 60 = 24 m) leaves every landmark unplaced.
    const trunks = [lane('trunk-local-1', 90, 15)];
    const rng = new SeededRandom(4);
    const { landmarks, diagnostics } = siteLandmarks(site(), green, trunks, builtRadiusM, rng);
    expect(landmarks).toEqual([]);
    expect(diagnostics.some((d) => d.includes('faith'))).toBe(true);
    expect(diagnostics.some((d) => d.includes('inn'))).toBe(true);
    expect(diagnostics.some((d) => d.includes('manor'))).toBe(true);
  });

  it('refuses claims that overlap one another (already placed this pass)', () => {
    // One short trunk, just long enough to offer ONE clear site inside
    // every band at once -- forces the second and third landmark drawn on
    // it to either move to another sample or fail.
    const trunks = [lane('trunk-local-1', 90, 60)];
    const rng = new SeededRandom(5);
    const { landmarks } = siteLandmarks(site(), green, trunks, builtRadiusM, rng);
    const obbs = landmarks.map((l) => lotObb(l.lot));
    for (let i = 0; i < obbs.length; i++) {
      for (let j = i + 1; j < obbs.length; j++) {
        expect(obbOverlap(obbs[i], obbs[j])).toBe(false);
      }
    }
  });

  it('refuses a site in water', () => {
    // A water polygon covering the whole east lane blocks every candidate.
    const trunks = [lane('trunk-local-1', 90)];
    const wetSite = site({
      water: [[
        new Point(-500, -500), new Point(500, -500), new Point(500, 500), new Point(-500, 500),
      ]],
    });
    const rng = new SeededRandom(6);
    const { landmarks, diagnostics } = siteLandmarks(wetSite, green, trunks, builtRadiusM, rng);
    expect(landmarks).toEqual([]);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it('does not overlap the green\'s drawn circle', () => {
    const trunks = [lane('trunk-local-1', 90)];
    const rng = new SeededRandom(7);
    const { landmarks } = siteLandmarks(site(), green, trunks, builtRadiusM, rng);
    const r = greenDrawnRadius(green);
    for (const lm of landmarks) {
      const obb = lotObb(lm.lot);
      // Cheap conservative check: every sampled corner is clear of the
      // green's drawn radius.
      const corners = [
        new Point(obb.center.x + obb.tangent.x * obb.halfW + obb.normal.x * obb.halfD,
          obb.center.y + obb.tangent.y * obb.halfW + obb.normal.y * obb.halfD),
        new Point(obb.center.x - obb.tangent.x * obb.halfW - obb.normal.x * obb.halfD,
          obb.center.y - obb.tangent.y * obb.halfW - obb.normal.y * obb.halfD),
      ];
      for (const c of corners) {
        expect(Math.hypot(c.x - green.centre.x, c.y - green.centre.y)).toBeGreaterThanOrEqual(r - 1e-6);
      }
    }
  });

  it('degrades to a diagnostic when a glyph is missing from the manifest', async () => {
    vi.resetModules();
    vi.doMock('../../src/village/glyphs.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/village/glyphs.js')>(
        '../../src/village/glyphs.js',
      );
      return {
        ...actual,
        hasGlyph: (glyph: string) => (glyph === 'sm-chapel' ? false : actual.hasGlyph(glyph)),
      };
    });
    const { siteLandmarks: siteLandmarksMocked } = await import('../../src/village/skeleton/landmarks.js');
    const trunks = [lane('trunk-local-1', 90)];
    const rng = new SeededRandom(8);
    const { landmarks, diagnostics } = siteLandmarksMocked(site(), green, trunks, builtRadiusM, rng);
    expect(landmarks.some((l) => l.kind === 'faith')).toBe(false);
    expect(diagnostics.some((d) => d.includes('faith') && d.includes('sm-chapel'))).toBe(true);
    vi.doUnmock('../../src/village/glyphs.js');
    vi.resetModules();
  });

  it('is deterministic: same input, same output', () => {
    const trunks = [lane('trunk-local-1', 90), lane('trunk-local-2', 200, 100)];
    const a = siteLandmarks(site(), green, trunks, builtRadiusM, new SeededRandom(42));
    const b = siteLandmarks(site(), green, trunks, builtRadiusM, new SeededRandom(42));
    expect(a).toEqual(b);
    // And the rng stream is untouched by this pass (no draws taken).
    const rng = new SeededRandom(42);
    const before = rng.getSeed();
    siteLandmarks(site(), green, trunks, builtRadiusM, rng);
    expect(rng.getSeed()).toBe(before);
  });
});
