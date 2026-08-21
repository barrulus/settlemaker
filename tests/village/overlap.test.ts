import { describe, it, expect } from 'vitest';
import {
  lotObb, obbOverlap, resolveConvergingLots, resolveInnerCurves,
} from '../../src/village/parcels/overlap.js';
import { MIN_LOT_DEPTH_M } from '../../src/village/constants.js';
import { Point } from '../../src/types/point.js';
import type { Green, Lane, Lot } from '../../src/village/types.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0), diameter: 20, bearingDeg: 0,
};

function lot(overrides: Partial<Lot>): Lot {
  return {
    id: 'lane:R0', laneId: 'lane', side: 1, front: new Point(0, 0), bearingDeg: 0,
    frontageM: 8, depthM: 16, score: 0, ...overrides,
  };
}

const mainLane: Lane = { id: 'main', type: 'main', points: [new Point(0, -20), new Point(0, 20)], widthM: 5 };
const trailLane: Lane = { id: 'trail', type: 'trail', points: [new Point(-20, 0), new Point(20, 0)], widthM: 2 };

describe('lotObb / obbOverlap', () => {
  it('builds the claim rectangle extending away from the lane', () => {
    // bearingDeg 0 (north) means the lot faces north (toward its lane); the
    // claim extends south (+y), away from it.
    const l = lot({ front: new Point(0, 0), bearingDeg: 0, frontageM: 4, depthM: 10 });
    const obb = lotObb(l);
    expect(obb.center.x).toBeCloseTo(0);
    expect(obb.center.y).toBeCloseTo(5);
    expect(obb.halfW).toBeCloseTo(2);
    expect(obb.halfD).toBeCloseTo(5);
  });

  it('reports overlap for two claims sharing ground', () => {
    const a = lotObb(lot({ front: new Point(0, 0), bearingDeg: 0, frontageM: 4, depthM: 10 }));
    const b = lotObb(lot({ front: new Point(1, 0), bearingDeg: 0, frontageM: 4, depthM: 10 }));
    expect(obbOverlap(a, b)).toBe(true);
  });

  it('reports no overlap for two claims far apart', () => {
    const a = lotObb(lot({ front: new Point(0, 0), bearingDeg: 0, frontageM: 4, depthM: 10 }));
    const b = lotObb(lot({ front: new Point(100, 0), bearingDeg: 0, frontageM: 4, depthM: 10 }));
    expect(obbOverlap(a, b)).toBe(false);
  });

  it('touching (shared edge, no interpenetration) does not count as overlap', () => {
    // Two lots side by side, fronts 4 m apart, each 4 m wide: edges just meet.
    const a = lotObb(lot({ front: new Point(-2, 0), bearingDeg: 0, frontageM: 4, depthM: 10 }));
    const b = lotObb(lot({ front: new Point(2, 0), bearingDeg: 0, frontageM: 4, depthM: 10 }));
    expect(obbOverlap(a, b)).toBe(false);
  });
});

describe('resolveInnerCurves (§5.4 rule 4)', () => {
  it('drops the later ordinal when consecutive fronts fold too close', () => {
    const lots: Lot[] = [
      lot({ id: 'lane:R0', front: new Point(0, 0), frontageM: 8 }),
      lot({ id: 'lane:R1', front: new Point(1, 0), frontageM: 8 }), // 1 m < 0.8 x 8
      lot({ id: 'lane:R2', front: new Point(20, 0), frontageM: 8 }),
    ];
    const result = resolveInnerCurves(lots);
    expect(result.map((l) => l.id)).toEqual(['lane:R0', 'lane:R2']);
  });

  it('leaves lots on different lanes or sides untouched', () => {
    const lots: Lot[] = [
      lot({ id: 'lane:R0', laneId: 'lane', side: 1, front: new Point(0, 0), frontageM: 8 }),
      lot({ id: 'lane:L0', laneId: 'lane', side: -1, front: new Point(0.5, 0), frontageM: 8 }),
      lot({ id: 'other:R0', laneId: 'other', front: new Point(0.5, 0), frontageM: 8 }),
    ];
    const result = resolveInnerCurves(lots);
    expect(result).toHaveLength(3);
  });

  it('collapses a multi-lot fold against the last survivor', () => {
    const lots: Lot[] = [
      lot({ id: 'lane:R0', front: new Point(0, 0), frontageM: 8 }),
      lot({ id: 'lane:R1', front: new Point(0.5, 0), frontageM: 8 }),
      lot({ id: 'lane:R2', front: new Point(1, 0), frontageM: 8 }),
    ];
    const result = resolveInnerCurves(lots);
    expect(result.map((l) => l.id)).toEqual(['lane:R0']);
  });
});

describe('resolveConvergingLots (§5.4 rule 3)', () => {
  it('a higher-class lane keeps its lot; the lower-class loser is dropped when its front is inside the winner claim', () => {
    const winnerLot = lot({
      id: 'main:R0', laneId: 'main', front: new Point(0, 0), bearingDeg: 0, frontageM: 20, depthM: 16,
    });
    const loserLot = lot({
      id: 'trail:R0', laneId: 'trail', front: new Point(0, 5), bearingDeg: 90, frontageM: 8, depthM: 16,
    });
    const result = resolveConvergingLots([winnerLot, loserLot], [mainLane, trailLane], green);
    expect(result.map((l) => l.id)).toEqual(['main:R0']);
  });

  it('truncates the loser depthM to the bisector when its front is outside the winner claim', () => {
    const winnerLot = lot({
      id: 'main:R0', laneId: 'main', front: new Point(0, 0), bearingDeg: 0, frontageM: 6, depthM: 16,
    });
    // Front well outside the winner's claim, but its own depth reaches in.
    const loserLot = lot({
      id: 'trail:R0', laneId: 'trail', front: new Point(10, 10), bearingDeg: 90, frontageM: 4, depthM: 16,
    });
    const result = resolveConvergingLots([winnerLot, loserLot], [mainLane, trailLane], green);
    const survivor = result.find((l) => l.id === 'trail:R0');
    expect(survivor).toBeDefined();
    expect(survivor!.depthM).toBeLessThan(16);
    expect(survivor!.depthM).toBeGreaterThanOrEqual(MIN_LOT_DEPTH_M - 1e-6);
    // The truncated claim really does clear the winner now.
    expect(obbOverlap(lotObb(winnerLot), lotObb(survivor!))).toBe(false);
  });

  it('drops the loser when truncation would leave it under MIN_LOT_DEPTH_M', () => {
    // Winner claim: x in [-3,3], y in [0,30].
    const winnerLot = lot({
      id: 'main:R0', laneId: 'main', front: new Point(0, 0), bearingDeg: 0, frontageM: 6, depthM: 30,
    });
    // Loser front sits just 3.5 m short of the winner's claim (outside it),
    // but its full 16 m depth reaches well past it — the clear depth
    // (~3.5 m) is under MIN_LOT_DEPTH_M (4 m), so it must be dropped, not
    // truncated to a sliver.
    const loserLot = lot({
      id: 'trail:R0', laneId: 'trail', front: new Point(0, -3.5), bearingDeg: 0, frontageM: 4, depthM: 16,
    });
    const result = resolveConvergingLots([winnerLot, loserLot], [mainLane, trailLane], green);
    expect(result.map((l) => l.id)).toEqual(['main:R0']);
  });

  it('the green ring wins over any lane lot regardless of class', () => {
    const ringLot = lot({
      id: 'green:R0', laneId: 'green', front: new Point(0, 0), bearingDeg: 0, frontageM: 6, depthM: 10,
    });
    const laneLot = lot({
      id: 'main:R0', laneId: 'main', front: new Point(0, 3), bearingDeg: 180, frontageM: 8, depthM: 16,
    });
    const result = resolveConvergingLots([ringLot, laneLot], [mainLane], green);
    expect(result.map((l) => l.id)).toContain('green:R0');
    expect(result.find((l) => l.id === 'main:R0')).toBeUndefined();
  });

  it('resolution does not depend on input array order', () => {
    const winnerLot = lot({
      id: 'main:R0', laneId: 'main', front: new Point(0, 0), bearingDeg: 0, frontageM: 20, depthM: 16,
    });
    const loserLot = lot({
      id: 'trail:R0', laneId: 'trail', front: new Point(0, 5), bearingDeg: 90, frontageM: 8, depthM: 16,
    });
    const forward = resolveConvergingLots([winnerLot, loserLot], [mainLane, trailLane], green);
    const backward = resolveConvergingLots([loserLot, winnerLot], [mainLane, trailLane], green);
    expect(forward.map((l) => l.id).sort()).toEqual(backward.map((l) => l.id).sort());
  });

  it('leaves non-overlapping lots alone', () => {
    const a = lot({ id: 'main:R0', laneId: 'main', front: new Point(0, 0), bearingDeg: 0, frontageM: 6, depthM: 16 });
    const b = lot({ id: 'trail:R0', laneId: 'trail', front: new Point(500, 0), bearingDeg: 90, frontageM: 6, depthM: 16 });
    const result = resolveConvergingLots([a, b], [mainLane, trailLane], green);
    expect(result).toHaveLength(2);
  });
});
