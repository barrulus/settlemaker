import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { snapshotLanesForChase } from '../../src/village/village-model.js';
import type { Lane } from '../../src/village/types.js';

/**
 * F2 (final fix wave): `restoreFirstHoused`'s snapshot of `lanes` used to be
 * a plain reference capture (`lanes` itself, or a shallow `.map` that reused
 * the same `Lane` objects). `extendOne` (`skeleton/lanes.ts`) mutates a
 * `Lane`'s `points` array IN PLACE --
 * `lane.points = [...lane.points, ...extension.slice(1)]` -- so a later
 * chase round calling back into growth mutates the SAME object an earlier
 * round's "snapshot" is still holding, and a discarded round's extension
 * survives the restore anyway.
 *
 * This test reproduces exactly that mutation pattern against
 * `snapshotLanesForChase`, the function `village-model.ts`'s chase snapshot
 * now uses, in isolation from the rest of the generation pipeline.
 */
describe('snapshotLanesForChase (F2: a faithful lane snapshot for the block chase)', () => {
  it('is unaffected when the source Lane object is mutated in place after the snapshot is taken', () => {
    const lane: Lane = {
      id: 'lane-090', type: 'local', widthM: 4,
      points: [new Point(0, 0), new Point(10, 0)],
    };
    const lanes: Lane[] = [lane];

    const snapshot = snapshotLanesForChase(lanes);

    // The exact mutation `extendOne` performs on a discarded chase round:
    // reassigns `.points` on the SAME Lane object, in place.
    lane.points = [...lane.points, new Point(20, 0)];

    expect(lane.points.length).toBe(3); // the live lane really did change
    expect(snapshot[0].points.length).toBe(2); // the snapshot must not
    expect(snapshot[0].points).toEqual([new Point(0, 0), new Point(10, 0)]);
  });

  it('returns fresh Lane objects and fresh points arrays, not the same references', () => {
    const lane: Lane = {
      id: 'lane-1', type: 'local', widthM: 4, points: [new Point(0, 0), new Point(5, 5)],
    };
    const [snap] = snapshotLanesForChase([lane]);
    expect(snap).not.toBe(lane);
    expect(snap.points).not.toBe(lane.points);
    expect(snap).toEqual(lane);
  });
});
