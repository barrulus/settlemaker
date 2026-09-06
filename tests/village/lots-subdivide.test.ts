import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import {
  F0_FLOOR_RATIO, GAP_LOOSE_M, GAP_TIGHT_M,
} from '../../src/village/constants.js';
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
    // Density verdicts, gate by gate: 2.4/1.0 -> 1.6/0.6 -> 1.2/0.4 ->
    // 0.8/0.4 (gate 5.1) -> 0.5/0.25 (gate 6.3, "his houses sit nearly
    // touching in continuous double-sided rows"). Taken from the constants
    // rather than restated, so the next verdict moves one place, not two.
    expect(gapForPopulation(100)).toBeCloseTo(GAP_LOOSE_M, 5);
    expect(gapForPopulation(900)).toBeCloseTo(GAP_TIGHT_M, 5);
    expect(gapForPopulation(900)).toBeLessThan(gapForPopulation(100));
  });

  it('clamps outside the village band', () => {
    expect(gapForPopulation(10)).toBeCloseTo(GAP_LOOSE_M, 5);
    expect(gapForPopulation(5000)).toBeCloseTo(GAP_TIGHT_M, 5);
  });
});

describe('frontageAt', () => {
  it('is f0 at the green', () => {
    expect(frontageAt(0, 100, 10)).toBeCloseTo(10, 5);
  });

  it('barely grows toward the fringe at all (gate 5.1: k = 0.1)', () => {
    // Gate 5.1 all but switched the gradient off. The owner's verdict was
    // that the widening WAS the sprawl: "at large pops it forces a very
    // spread-out settlement with far too uniform spacing." A fringe plot
    // now stays within ~10% of f0, and the variation the render shows
    // comes from FRONTAGE_JITTER and seat failures instead.
    const fringe = frontageAt(100, 100, 10);
    expect(fringe).toBeGreaterThan(10);
    expect(fringe).toBeLessThanOrEqual(11);
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
    // Asserted as a TREND over seeds rather than pinned to one. Frontage
    // widening outward is a bias applied to a jittered cut, so it holds for
    // about two thirds of seeds individually and for the mean decisively
    // (measured across seeds 1..40: mean first 10.08 m, mean last 11.26 m).
    // It used to be pinned at seed 1, which passed only because the old
    // `SeededRandom` made neighbouring seeds near-identical -- one lucky
    // draw stood in for the population. With seeds decorrelated (G1,
    // 2026-09-06) the honest form of this bar is the trend itself.
    let first = 0;
    let last = 0;
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const lots = subdivideLane(straightLane, green, 100, 10, 25, new SeededRandom(seed))
        .filter((l) => l.side === 1);
      if (lots.length < 2) continue;
      first += lots[0].frontageM;
      last += lots[lots.length - 1].frontageM;
      n += 1;
    }
    expect(n).toBeGreaterThan(20);
    expect(last / n).toBeGreaterThan(first / n);
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
