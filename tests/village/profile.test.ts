import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import {
  buildRadiusProfile, circularProfile, roadAxis,
} from '../../src/village/skeleton/profile.js';
import {
  PROFILE_MIN_CV, PROFILE_SEED_MULTIPLIER, PROFILE_SEED_OFFSET, PROFILE_SHAPE_MAX,
  PROFILE_SHAPE_MIN,
} from '../../src/village/constants.js';
import type { RadiusProfile } from '../../src/village/skeleton/profile.js';

const centre = new Point(0, 0);
const villageRng = (seed: number): SeededRandom => new SeededRandom(
  seed * PROFILE_SEED_MULTIPLIER + PROFILE_SEED_OFFSET,
);

/** The area a profile actually encloses: (1/2) integral R(theta)^2 dtheta. */
function enclosedArea(p: RadiusProfile, samples = 7200): number {
  let area = 0;
  for (let i = 0; i < samples; i++) {
    const r = p.at((i * 360) / samples);
    area += 0.5 * r * r * ((2 * Math.PI) / samples);
  }
  return area;
}

function shapeStats(p: RadiusProfile): { ratio: number; cv: number } {
  const v: number[] = [];
  for (let i = 0; i < 24; i++) v.push(p.shapeAt(i * 15 + 7.5));
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  return { ratio: Math.max(...v) / Math.min(...v), cv: sd / mean };
}

/**
 * GATE 8. The profile is the shape of the ground a village grows into. Its
 * contract has exactly two halves: it must NOT be a circle, and it must
 * enclose exactly the area the census bought -- because every density
 * figure the gate-6.6..6.11 campaign established is arithmetic over that
 * area, and a shape that quietly bought more ground would hand back the
 * whole campaign.
 */
describe('radius profile (gate 8)', () => {
  const seeds = [1, 2, 3, 4, 5, 11, 37];

  it('AREA-PRESERVING: encloses exactly pi * radiusM^2, whatever shape it draws', () => {
    for (const seed of seeds) {
      for (const radiusM of [40, 52, 88, 150]) {
        const p = buildRadiusProfile({
          centre, radiusM, trunkBearingsDeg: [225], water: [], rng: villageRng(seed),
        });
        expect(enclosedArea(p) / (Math.PI * radiusM * radiusM)).toBeCloseTo(1, 3);
      }
    }
  });

  it('area survives scaling: k times the radius is k^2 times the ground', () => {
    const p = buildRadiusProfile({
      centre, radiusM: 60, trunkBearingsDeg: [90], water: [], rng: villageRng(2),
    });
    expect(enclosedArea(p.scaled(1.5)) / enclosedArea(p)).toBeCloseTo(2.25, 3);
    expect(p.scaled(1.5).at(37)).toBeCloseTo(p.at(37) * 1.5, 6);
  });

  it('is NOT a circle: every seed clears the irregularity floor', () => {
    for (const seed of seeds) {
      const p = buildRadiusProfile({
        centre, radiusM: 80, trunkBearingsDeg: [225], water: [], rng: villageRng(seed),
      });
      const { ratio, cv } = shapeStats(p);
      // The floor the boost enforces, less a whisker for the clamp and the
      // area normalisation that follow it.
      expect(cv).toBeGreaterThan(PROFILE_MIN_CV * 0.9);
      expect(ratio).toBeGreaterThan(1.5);
    }
  });

  it('stays inside the shape clamp: no pinch, no tentacle', () => {
    for (const seed of seeds) {
      const p = buildRadiusProfile({
        centre, radiusM: 80, trunkBearingsDeg: [225], water: [], rng: villageRng(seed),
      });
      for (let deg = 0; deg < 360; deg += 1) {
        // The clamp is applied before area normalisation, which can only
        // scale the whole shape by a few percent either way.
        expect(p.shapeAt(deg)).toBeGreaterThan(PROFILE_SHAPE_MIN * 0.85);
        expect(p.shapeAt(deg)).toBeLessThan(PROFILE_SHAPE_MAX * 1.15);
      }
    }
  });

  it('is deterministic in its seed, and differs between seeds', () => {
    const mk = (seed: number): number[] => {
      const p = buildRadiusProfile({
        centre, radiusM: 70, trunkBearingsDeg: [10], water: [], rng: villageRng(seed),
      });
      return Array.from({ length: 36 }, (_, i) => p.at(i * 10));
    };
    expect(mk(3)).toEqual(mk(3));
    expect(mk(3)).not.toEqual(mk(4));
  });

  it('grows ALONG the road: the long axis lies on the trunk bearing', () => {
    // Averaged over seeds, because one seed's harmonics can locally beat
    // the axis term -- the axis is a bias, not a straitjacket.
    let along = 0;
    let across = 0;
    for (const seed of seeds) {
      const p = buildRadiusProfile({
        centre, radiusM: 80, trunkBearingsDeg: [0, 180], water: [], rng: villageRng(seed),
      });
      along += (p.at(0) + p.at(180)) / 2;
      across += (p.at(90) + p.at(270)) / 2;
    }
    expect(along / across).toBeGreaterThan(1.15);
  });

  it('a crossroads has no long way round: symmetric arms cancel to no axis', () => {
    expect(roadAxis([0, 90, 180, 270]).strength).toBeCloseTo(0, 6);
    expect(roadAxis([45]).strength).toBeCloseTo(1, 6);
    expect(roadAxis([45, 225]).axisDeg).toBeCloseTo(45, 6);
  });

  it('measures a narrow stream across its banks even for oblique profile rays', () => {
    const water = [[new Point(3,-1000),new Point(7,-1000),new Point(7,1000),new Point(3,1000)]];
    const input = {centre, radiusM:80, trunkBearingsDeg:[135]};
    const dry = buildRadiusProfile({...input, water:[], rng:villageRng(1)});
    const wet = buildRadiusProfile({...input, water, rng:villageRng(1)});
    for(let bearing=0;bearing<360;bearing++)expect(wet.at(bearing)).toBeCloseTo(dry.at(bearing),8);
  });

  it('never grows a lobe into the water', () => {
    // Water fills the half-plane east of x = 40; the profile must be pulled
    // in on the bearings that face it (090) and untouched to the west.
    const water = [[
      new Point(40, -400), new Point(400, -400), new Point(400, 400), new Point(40, 400),
    ]];
    const dry = buildRadiusProfile({
      centre, radiusM: 80, trunkBearingsDeg: [0], water: [], rng: villageRng(9),
    });
    const wet = buildRadiusProfile({
      centre, radiusM: 80, trunkBearingsDeg: [0], water, rng: villageRng(9),
    });
    // The shore is at x = 40, and the margin keeps the village off it.
    expect(wet.at(90)).toBeLessThanOrEqual(40 - 6 + 1e-6);
    expect(wet.at(90)).toBeLessThan(dry.at(90));
    // And the area is STILL the census's area: the ground the water took is
    // given back on the dry side.
    expect(enclosedArea(wet) / (Math.PI * 80 * 80)).toBeGreaterThan(0.97);
    expect(wet.at(270)).toBeGreaterThan(dry.at(270) * 0.95);
  });

  it('circularProfile is the disc this gate replaces', () => {
    const p = circularProfile(50);
    for (let deg = 0; deg < 360; deg += 7) expect(p.at(deg)).toBeCloseTo(50, 9);
    expect(enclosedArea(p)).toBeCloseTo(Math.PI * 2500, 3);
  });
});
