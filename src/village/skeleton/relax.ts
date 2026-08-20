import { Point } from '../../types/point.js';
import { dist } from '../geometry.js';
import { inkExtent } from '../glyphs.js';
import {
  RELAX_CLEARANCE_M, RELAX_ITERATIONS, RELAX_MAX_DISPLACEMENT_M, TAIL_STUB_M,
} from '../constants.js';
import type { Building, Lane } from '../types.js';

/**
 * Lanes bend around the houses they acquired. The skeleton was solved
 * before anyone lived there, so a building can end up sitting on its own
 * lane; relaxation nudges each lane point clear of any building whose ink
 * extent overlaps it. Bounded at RELAX_ITERATIONS iterations and clamped to
 * RELAX_MAX_DISPLACEMENT_M total displacement from its original position so
 * the geometry cannot wander and determinism holds.
 *
 * Pure function of its inputs: no RNG, no mutation of the input lanes.
 */
export function relaxLanes(lanes: Lane[], buildings: Building[]): Lane[] {
  return lanes.map((lane) => {
    const origin = lane.points.map((p) => new Point(p.x, p.y));
    const points = lane.points.map((p) => new Point(p.x, p.y));

    for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
      for (let i = 0; i < points.length; i++) {
        for (const b of buildings) {
          const ink = inkExtent(b.glyph, b.footprint);
          const keepOut = lane.widthM / 2 + RELAX_CLEARANCE_M + Math.max(ink.width, ink.depth) / 2;
          const dx = points[i].x - b.position.x;
          const dy = points[i].y - b.position.y;
          const d = Math.hypot(dx, dy);
          if (d === 0 || d >= keepOut) continue;
          const push = (keepOut - d) / RELAX_ITERATIONS;
          points[i] = new Point(points[i].x + (dx / d) * push, points[i].y + (dy / d) * push);
        }
      }
    }

    // Clamp total displacement against the ORIGINAL position, not
    // iteration-to-iteration, so the cap can never be exceeded regardless
    // of how many buildings pushed on a point across the iterations.
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - origin[i].x;
      const dy = points[i].y - origin[i].y;
      const d = Math.hypot(dx, dy);
      if (d > RELAX_MAX_DISPLACEMENT_M) {
        points[i] = new Point(
          origin[i].x + (dx / d) * RELAX_MAX_DISPLACEMENT_M,
          origin[i].y + (dy / d) * RELAX_MAX_DISPLACEMENT_M,
        );
      }
    }

    return { ...lane, points };
  });
}

/**
 * A lane tail that acquired no dwelling is the straggle at the edge of the
 * fabric: a road running 200 m past the last cottage looks like a mistake,
 * a road stopping dead at the last cottage looks unnatural. Trim each lane
 * back to its furthest-out building plus a TAIL_STUB_M stub.
 *
 * A building belongs to a lane only when its lotId's lane-id segment is an
 * exact match — `arm-090:R3` belongs to `arm-090`, but `arm-090/b50:R3`
 * (a branch lane with its own separate id) must not be claimed by
 * `arm-090`'s prefix test. Matching on `${lane.id}:` rather than a bare
 * `startsWith(lane.id)` is what keeps that boundary honest.
 */
export function trimTails(lanes: Lane[], buildings: Building[]): Lane[] {
  const prefixOf = (laneId: string) => `${laneId}:`;

  return lanes.map((lane) => {
    const prefix = prefixOf(lane.id);
    const mine = buildings.filter((b) => b.lotId.startsWith(prefix));

    // A lane with no dwellings of its own has no "last building" to trim
    // back to — the whole thing is tail, so it is treated the same as a
    // lane whose furthest dwelling sits right at the green (furthest = 0):
    // trimmed down to a bare stub, not left at full length.
    const start = lane.points[0];
    const furthest = mine.reduce((best, b) => Math.max(best, dist(b.position, start)), 0);
    const cutoff = furthest + TAIL_STUB_M;

    const keep = lane.points.filter((p) => dist(p, start) <= cutoff);

    // A lane must always keep at least two points — a single point is not
    // a lane. If the trim window collapsed below that (the last dwelling
    // sits well inside the first segment), fall back to the lane's own
    // first two points, which is the shortest possible stub this lane can
    // honestly offer.
    if (keep.length < 2) return { ...lane, points: lane.points.slice(0, 2) };

    return { ...lane, points: keep };
  });
}
