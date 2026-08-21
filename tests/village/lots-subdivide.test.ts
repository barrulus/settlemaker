import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { F0_FLOOR_RATIO } from '../../src/village/constants.js';
import { frontageAt, gapForPopulation, subdivideLane } from '../../src/village/parcels/lots.js';
import type { Green, Lane } from '../../src/village/types.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

const straightLane: Lane = {
  id: 'arm-090', type: 'main', widthM: 5,
  points: [new Point(10, 0), new Point(210, 0)],
};

describe('gapForPopulation', () => {
  it('is loose in a hamlet and tight in a big village', () => {
    expect(gapForPopulation(100)).toBeCloseTo(2.4, 1);
    expect(gapForPopulation(900)).toBeCloseTo(1.0, 1);
    expect(gapForPopulation(900)).toBeLessThan(gapForPopulation(100));
  });

  it('clamps outside the village band', () => {
    expect(gapForPopulation(10)).toBeCloseTo(2.4, 1);
    expect(gapForPopulation(5000)).toBeCloseTo(1.0, 1);
  });
});

describe('frontageAt', () => {
  it('is f0 at the green', () => {
    expect(frontageAt(0, 100, 10)).toBeCloseTo(10, 5);
  });

  it('grows to roughly 2x f0 at the fringe (cluster gradient)', () => {
    // 2026-08-21 gate: the 3-4x gradient spread the fabric; the cluster
    // rework flattened GRADIENT_K so the fringe sits around twice f0.
    const fringe = frontageAt(100, 100, 10);
    expect(fringe).toBeGreaterThan(17);
    expect(fringe).toBeLessThan(25);
  });

  it('grows monotonically outward', () => {
    expect(frontageAt(50, 100, 10)).toBeGreaterThan(frontageAt(20, 100, 10));
  });
});

describe('subdivideLane', () => {
  it('cuts lots on both sides of the lane', () => {
    const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(1));
    expect(lots.some((l) => l.side === 1)).toBe(true);
    expect(lots.some((l) => l.side === -1)).toBe(true);
  });

  it('numbers lots from the green end and gives them stable ids', () => {
    const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(1));
    const right = lots.filter((l) => l.side === 1);
    expect(right[0].id).toBe('arm-090:R0');
    expect(right[1].id).toBe('arm-090:R1');
  });

  it('faces every lot back toward its lane', () => {
    const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(1));
    const right = lots.find((l) => l.side === 1)!;
    const left = lots.find((l) => l.side === -1)!;
    // The lane runs east; right-side lots look north, left-side lots look south.
    expect(right.bearingDeg).toBeCloseTo(0, 0);
    expect(left.bearingDeg).toBeCloseTo(180, 0);
  });

  it('widens frontage outward', () => {
    const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(1))
      .filter((l) => l.side === 1);
    expect(lots[lots.length - 1].frontageM).toBeGreaterThan(lots[0].frontageM);
  });

  it('never cuts a lot narrower than the F0 floor ratio', () => {
    // The floor is F0_FLOOR_RATIO x f0, not f0: a slightly-tight cut plus
    // fit-sizing is what lets neighbours touch (2026-08-21 density rule).
    const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(2));
    for (const l of lots) expect(l.frontageM).toBeGreaterThanOrEqual(10 * F0_FLOOR_RATIO - 1e-9);
  });

  it('is deterministic for a seed', () => {
    const mk = () => subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(5));
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });

  it('sets lots back further from a royal lane than a footpath, same geometry', () => {
    const royalLane: Lane = { ...straightLane, id: 'arm-090-royal', type: 'royal' };
    const footpathLane: Lane = { ...straightLane, id: 'arm-090-footpath', type: 'footpath' };
    const royalLots = subdivideLane(royalLane, green, 100, 10, 25, new SeededRandom(1));
    const footpathLots = subdivideLane(footpathLane, green, 100, 10, 25, new SeededRandom(1));
    // The lane itself runs along y=0, so a lot's |y| is exactly its setback
    // from the carriageway (side=1 offsets to +y, side=-1 to -y).
    const royalOffset = Math.abs(royalLots.find((l) => l.side === 1)!.front.y);
    const footpathOffset = Math.abs(footpathLots.find((l) => l.side === 1)!.front.y);
    expect(royalOffset).toBeGreaterThan(footpathOffset);
  });
});
