import { offsetPolyline } from './strip.js';
import { lotObb, maxDepthClearOf, obbOverlap, type Obb } from './overlap.js';
import { arcLengths, closestPointOnSegment, dist, sampleAt } from '../geometry.js';
import { frontageAt } from './lots.js';
import {
  CLAIM_TOUCH_EPS_M, F0_FLOOR_RATIO, LANE_SETBACK_M, MIN_BUILD_DEPTH_M,
} from '../constants.js';
import { Point } from '../../types/point.js';
import { recutLotId, type Green, type Lane, type Lot } from '../types.js';

/**
 * GATE 6.9 -- RE-CUT THE FREED GROUND.
 *
 * The gate-6.7 histogram is the reason this file exists. Of every lot a
 * village cuts, 33-38% die in `resolveConvergingLots`, and a lot killed
 * there does not become anything else: its frontage simply goes back to
 * grass. Concentrated at junction mouths and between parallel lanes, that
 * is exactly the emptiness the owner has circled at every gate since 6.4 --
 * not a shortage of ground, a shortage of PLOTS on ground the fabric
 * already paid for.
 *
 * So after resolution has settled, walk each lane side ONE MORE TIME and
 * look at what is actually free. Wherever a stretch of frontage at least
 * one usable dwelling wide now has nothing standing on it, cut a new lot
 * there -- and cut it SHALLOW, to whatever depth genuinely fits between the
 * claims that survived. A house with no garden is a legitimate village
 * plot; a 12 m claim that could not fit and so became nothing is not.
 *
 * ## Why this pass constructs disjoint claims instead of re-resolving
 *
 * Every candidate is depth-clipped against every surviving claim it
 * touches, against the lots this pass has already added, and against the
 * lane corridors -- so the lots it returns are disjoint from the fabric by
 * CONSTRUCTION, and §5.7 still holds without running §5.4's resolution over
 * the combined set. That matters: resolution orders a strip by ordinal and
 * reads consecutive ordinals as neighbours, and a re-cut lot is by
 * definition the lot that sits BETWEEN two first-pass ordinals. Feeding
 * them back through the fold test would read every one of them as a fold
 * against the survivor beside it and delete the whole pass.
 *
 * ## Determinism
 *
 * No `SeededRandom` is drawn here, deliberately. The first cut jitters its
 * frontages (`FRONTAGE_JITTER`); this pass does not, so adding the pass
 * cannot shift the draw sequence of anything downstream of it. A re-cut lot
 * is as wide as the gradient says and no wider.
 *
 * The green's own ring is NOT re-cut: its lots are laid in the free arcs
 * between road mouths by `subdivideGreen`, which already accounts for what
 * blocks them, and it is a single closed strip rather than a walk.
 */

/** A half-open stretch of a strip's arc length, in metres from its start. */
type Span = [number, number];

/** Merge overlapping/abutting spans, then return the gaps between them. */
function freeSpans(occupied: Span[], totalM: number): Span[] {
  if (occupied.length === 0) return totalM > 0 ? [[0, totalM]] : [];
  const sorted = [...occupied].sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const gaps: Span[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push([cursor, Math.min(s, totalM)]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < totalM) gaps.push([cursor, totalM]);
  return gaps.filter(([s, e]) => e > s);
}

/** Where along `edge` a point projects, in arc length from the start. */
function arcPositionOf(edge: Point[], acc: number[], p: Point): number {
  let best = Infinity;
  let bestS = 0;
  for (let i = 1; i < edge.length; i++) {
    const q = closestPointOnSegment(p, edge[i - 1], edge[i]);
    const d = dist(p, q);
    if (d < best) {
      best = d;
      bestS = acc[i - 1] + dist(edge[i - 1], q);
    }
  }
  return bestS;
}

/**
 * The deepest claim <= `lot.depthM` that keeps clear of every OTHER lane's
 * carriageway. A re-cut lot is cut at a junction more often than not, so its
 * claim is the one most likely to be laid across a road it is not fronting,
 * and a garden over a lane is the same defect as a house in one.
 *
 * The lot's OWN lane is excluded: its claim starts a full setback back from
 * that carriageway by construction, and testing it there only ever produces
 * a false positive.
 */
function maxDepthClearOfLanes(lot: Lot, lanes: Lane[]): number {
  let depth = lot.depthM;
  for (const lane of lanes) {
    if (lane.id === lot.laneId) continue;
    for (let i = 1; i < lane.points.length; i++) {
      if (depth < MIN_BUILD_DEPTH_M) return depth;
      const a = lane.points[i - 1];
      const b = lane.points[i];
      const len = dist(a, b);
      if (len <= 0) continue;
      // The segment's own oriented box: half its length along the road,
      // the lane's half width across it.
      const t = new Point((b.x - a.x) / len, (b.y - a.y) / len);
      const corridor: Obb = {
        center: new Point((a.x + b.x) / 2, (a.y + b.y) / 2),
        tangent: t,
        normal: new Point(-t.y, t.x),
        halfW: len / 2,
        halfD: lane.widthM / 2,
      };
      const claim = lotObb({ ...lot, depthM: depth });
      if (!obbOverlap(claim, corridor)) continue;
      depth = maxDepthClearOf({ ...lot, depthM: depth }, corridor);
    }
  }
  return depth;
}

export interface RecutInput {
  lanes: Lane[];
  green: Green;
  /** Every claim already standing: the survivors of §5.4 resolution. */
  standing: Lot[];
  /** The saturated disc, as the frontage gradient's reference. */
  builtRadiusM: number;
  f0: number;
  /** The full lot depth a first-pass lot would have had. */
  depthM: number;
  /** The deck's narrowest usable dwelling frontage — a hard floor. */
  floorM: number;
  maxFrontageM: number;
  /** How far out along a given lane lots may be cut at all. */
  reachOf: (lane: Lane) => number;
  /** Which re-cut pass this is; part of the lot id. */
  pass: number;
}

export interface RecutResult {
  /** The new lots, disjoint from the fabric by construction. */
  added: Lot[];
  /**
   * Standing lots whose GARDEN gave way to make room for one of them, by
   * id, with the depth they keep. Never below `MIN_BUILD_DEPTH_M`, and
   * never deeper than the lot already was.
   */
  trimmed: Map<string, number>;
}

export function recutFreedGround(input: RecutInput): RecutResult {
  const {
    lanes, green, standing, builtRadiusM, f0, depthM, floorM, maxFrontageM, reachOf, pass,
  } = input;
  // The lots this pass adds, held as live claim records: one added earlier
  // in the pass can itself give way to one added later, and the depth that
  // is RETURNED must be the depth it ended up with, not the depth it was
  // first cut at. (Measured: without this, one pop-900 seed shipped a pair
  // of re-cut claims overlapping by 6 m and the §5.7 net caught it.)
  const addedClaims: Array<{ lot: Lot; depth: number }> = [];
  const trimmed = new Map<string, number>();
  // Claims to clear: everything standing, plus what this pass has added.
  // `depth` is mutable — a standing GARDEN may give way to a new house.
  const claims: Array<{ lot: Lot; depth: number }> = standing.map((lot) => ({
    lot, depth: lot.depthM,
  }));
  const addedIds = new Set<string>();
  const obbOf = (c: { lot: Lot; depth: number }): Obb =>
    lotObb({ ...c.lot, depthM: c.depth });
  const reachOfClaim = (c: { lot: Lot; depth: number }): number =>
    Math.hypot(c.lot.frontageM / 2, c.depth);

  for (const lane of lanes) {
    const setback = lane.widthM / 2 + (LANE_SETBACK_M[lane.type] ?? 2);
    const maxDistanceM = reachOf(lane);
    for (const side of [1, -1] as const) {
      const edge = offsetPolyline(lane.points, setback, side);
      if (edge.length < 2) continue;
      const acc = arcLengths(edge);
      const total = acc[acc.length - 1];
      if (total <= floorM) continue;

      const occupied: Span[] = [];
      for (const lot of standing) {
        if (lot.laneId !== lane.id || lot.side !== side) continue;
        const mid = arcPositionOf(edge, acc, lot.front);
        occupied.push([
          mid - lot.frontageM / 2 - CLAIM_TOUCH_EPS_M,
          mid + lot.frontageM / 2 + CLAIM_TOUCH_EPS_M,
        ]);
      }

      let ordinal = 0;
      for (const [spanStart, spanEnd] of freeSpans(occupied, total)) {
        if (spanEnd - spanStart < floorM) continue;
        let s = spanStart;
        while (s + floorM <= spanEnd) {
          const at = sampleAt(edge, acc, s);
          const d = dist(at.p, green.centre);
          const cap = Math.max(floorM, maxFrontageM);
          const frontage = Math.min(
            cap,
            Math.max(floorM, f0 * F0_FLOOR_RATIO, frontageAt(d, builtRadiusM, f0)),
            spanEnd - s,
          );
          // A probing step, not the plot width: where a slot is refused
          // (too far out, or nothing deep enough fits) the walk advances by
          // half a floor rather than a whole plot, so one pass finds every
          // seatable position in the gap instead of leaving a tail for the
          // next one.
          const probeStep = floorM / 2;
          if (frontage < floorM) break;
          const mid = sampleAt(edge, acc, s + frontage / 2);
          const midD = dist(mid.p, green.centre);
          if (midD > maxDistanceM) { s += probeStep; continue; }
          const bearingDeg = (mid.dirDeg + (side === 1 ? -90 : 90) + 360) % 360;
          const candidate: Lot = {
            id: recutLotId(lane.id, side, ordinal, pass),
            laneId: lane.id,
            side,
            front: mid.p,
            bearingDeg,
            frontageM: frontage,
            depthM,
            score: 0,
          };
          // GARDENS GIVE WAY TO HOUSES -- gate 6.7's rule, applied at
          // re-cut time, and the measurement that forced it: with the
          // standing claims held at their full depth this pass produced 15
          // lots at pop 300 against 350 m of genuinely free frontage per
          // round. The frontage was not the constraint; a surviving
          // neighbour's BACK GARDEN lying across it was.
          //
          // So the candidate is measured against what each neighbour would
          // hold if it kept only its house (`MIN_BUILD_DEPTH_M`), and every
          // neighbour that actually had to give ground is then handed back
          // as much of its garden as fits beside the new plot. Nobody ends
          // up below their own house, nobody ends up deeper than they were,
          // and the result is still disjoint.
          const neighbours = claims.filter((c) =>
            dist(candidate.front, c.lot.front)
              <= Math.hypot(frontage / 2, depthM) + reachOfClaim(c));
          let depth = maxDepthClearOfLanes(candidate, lanes);
          for (const other of neighbours) {
            if (depth < MIN_BUILD_DEPTH_M) break;
            const yielded = obbOf({ ...other, depth: Math.min(other.depth, MIN_BUILD_DEPTH_M) });
            if (!obbOverlap(lotObb({ ...candidate, depthM: depth }), yielded)) continue;
            depth = maxDepthClearOf({ ...candidate, depthM: depth }, yielded);
          }
          if (depth < MIN_BUILD_DEPTH_M) { s += probeStep; continue; }
          const lot: Lot = { ...candidate, depthM: depth };
          const lotClaim = lotObb(lot);
          for (const other of neighbours) {
            if (!obbOverlap(obbOf(other), lotClaim)) continue;
            const kept = Math.max(
              Math.min(other.depth, MIN_BUILD_DEPTH_M),
              maxDepthClearOf({ ...other.lot, depthM: other.depth }, lotClaim),
            );
            other.depth = kept;
            // Only STANDING lots go in `trimmed`; a lot this pass added is
            // carried by its own claim record and re-read at return.
            if (!addedIds.has(other.lot.id)) trimmed.set(other.lot.id, kept);
          }
          const record = { lot, depth: lot.depthM };
          addedClaims.push(record);
          addedIds.add(lot.id);
          claims.push(record);
          ordinal++;
          s += frontage + CLAIM_TOUCH_EPS_M;
        }
      }
    }
  }
  return {
    added: addedClaims.map((c) => ({ ...c.lot, depthM: c.depth })),
    trimmed,
  };
}
