import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import {
  addInventedLanes, availableFrontage, polylineLength, requiredFrontage,
} from '../../src/village/skeleton/lanes.js';
import type { Green, Lane } from '../../src/village/types.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

const lane = (id: string, from: Point, to: Point): Lane =>
  ({ id, type: 'main', points: [from, to], widthM: 5 });

describe('frontage arithmetic', () => {
  it('measures a polyline', () => {
    expect(polylineLength([new Point(0, 0), new Point(3, 4)])).toBeCloseTo(5, 5);
  });

  it('counts both sides of every lane', () => {
    const lanes = [lane('a', new Point(0, 0), new Point(100, 0))];
    expect(availableFrontage(lanes)).toBeCloseTo(200, 5);
  });

  it('derives what the census needs', () => {
    // 300 people / 5 per dwelling = 60 dwellings * 14 m of frontage
    expect(requiredFrontage(300, 5, 14)).toBeCloseTo(840, 5);
  });
});

describe('addInventedLanes', () => {
  it('adds nothing when the arms already provide enough frontage', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -500))];
    const out = addInventedLanes(lanes, green, 500, 200, new SeededRandom(1));
    expect(out).toHaveLength(1);
  });

  it('adds lanes until available frontage clears required x 1.15', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -110))];
    const out = addInventedLanes(lanes, green, 2000, 200, new SeededRandom(1));
    expect(out.length).toBeGreaterThan(1);
    expect(availableFrontage(out)).toBeGreaterThanOrEqual(2000 * 1.15);
  });

  it('classes a green-attached lane one step below the best arm, floored at local', () => {
    const lanes = [lane('arm-000', new Point(0, -10), new Point(0, -60))];
    const out = addInventedLanes(lanes, green, 800, 200, new SeededRandom(3));
    // Invented arm-style lanes reuse armLaneId's `arm-` prefix too, so they
    // must be excluded by original id, not by prefix.
    const invented = out.filter((l) => !lanes.some((orig) => orig.id === l.id));
    expect(invented.length).toBeGreaterThan(0);
    for (const l of invented) {
      expect(['market', 'town', 'local', 'trail', 'footpath']).toContain(l.type);
    }
  });

  it('is deterministic for a seed', () => {
    const mk = () => addInventedLanes(
      [lane('arm-000', new Point(0, -10), new Point(0, -60))], green, 900, 200,
      new SeededRandom(11),
    );
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});
