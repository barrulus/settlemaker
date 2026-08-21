import { Point } from '../../types/point.js';
import { bearingVector, dist } from '../geometry.js';
import { classRank, type RouteType } from '../route-class.js';
import { INNER_CURVE_FRONT_RATIO, MIN_LOT_DEPTH_M } from '../constants.js';
import type { Green, Lane, Lot } from '../types.js';

/**
 * §5.4 rules 3-4: pay the R20 debt. Lots are cut per-lane (and for the
 * green ring) independently, so where strips converge — a lane joining
 * another, a tight bend folding a strip back on itself, a lane meeting the
 * green — the raw claims (frontage x depth, extending from `front` away
 * from the lane) overlap. `clipLots` only ever dropped water/green-interior
 * lots; this is the pass that makes surviving claims disjoint, which the
 * crofts/fields passes need since they consume lot DEPTH.
 *
 * Two stages, run in this order:
 *  1. `resolveInnerCurves` — within one lane+side strip, a fold or a
 *     wander-driven deep overlap (rule 4).
 *  2. cross-strip resolution — any two lots whose (laneId, side) differ,
 *     including the green ring against itself (rule 3, plus the ring-vs-
 *     ring edge case the brief calls out even though mouths are pre-gapped
 *     so it should not normally fire).
 */

export interface Obb { center: Point; tangent: Point; normal: Point; halfW: number; halfD: number }

/**
 * A lot's claim: `frontageM` wide along the tangent, `depthM` deep along
 * the inverse of its bearing (bearingDeg points AT the lot's lane/green;
 * the claim extends away from it).
 */
export function lotObb(lot: Lot): Obb {
  const facing = bearingVector(lot.bearingDeg);
  const normal = new Point(-facing.x, -facing.y);
  const tangent = new Point(-facing.y, facing.x);
  const halfD = lot.depthM / 2;
  return {
    center: new Point(lot.front.x + normal.x * halfD, lot.front.y + normal.y * halfD),
    tangent,
    normal,
    halfW: lot.frontageM / 2,
    halfD,
  };
}

/**
 * Separating-axis test over both rectangles' axes (mirrors the OBB SAT in
 * dwellings.ts, kept local so parcels never depends on the dwellings pass).
 * `eps` is slack allowed before two claims count as overlapping: 0 for
 * resolution (settle for genuinely disjoint), a small positive value for
 * the property test (float noise).
 */
export function obbOverlap(a: Obb, b: Obb, eps = 0): boolean {
  const d = new Point(b.center.x - a.center.x, b.center.y - a.center.y);
  for (const axis of [a.tangent, a.normal, b.tangent, b.normal]) {
    const gap = Math.abs(d.x * axis.x + d.y * axis.y);
    const spanA = Math.abs(a.tangent.x * axis.x + a.tangent.y * axis.y) * a.halfW
      + Math.abs(a.normal.x * axis.x + a.normal.y * axis.y) * a.halfD;
    const spanB = Math.abs(b.tangent.x * axis.x + b.tangent.y * axis.y) * b.halfW
      + Math.abs(b.normal.x * axis.x + b.normal.y * axis.y) * b.halfD;
    if (gap >= spanA + spanB - eps) return false;
  }
  return true;
}

/** True when `p` lies inside (or on) `obb`. */
function pointInObb(p: Point, obb: Obb): boolean {
  const d = new Point(p.x - obb.center.x, p.y - obb.center.y);
  const alongT = Math.abs(d.x * obb.tangent.x + d.y * obb.tangent.y);
  const alongN = Math.abs(d.x * obb.normal.x + d.y * obb.normal.y);
  return alongT <= obb.halfW && alongN <= obb.halfD;
}

/**
 * The largest depth <= `lot.depthM` whose claim no longer overlaps
 * `winner`, floored at 0. ~8 bisections is plenty at metre precision.
 */
function maxDepthClearOf(lot: Lot, winner: Obb): number {
  let lo = 0;
  let hi = lot.depthM;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const trial = lotObb({ ...lot, depthM: mid });
    if (obbOverlap(trial, winner)) hi = mid; else lo = mid;
  }
  return lo;
}

function ordinalOf(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Rule 4: within one lane+side strip, a tight bend can fold the offset
 * edge so consecutive lots' fronts land closer together (along the chord)
 * than INNER_CURVE_FRONT_RATIO of the group's mean frontage. That is a
 * genuine fold, and the fold is removed, never squeezed: drop the later
 * ordinal and keep comparing the next lot against the last SURVIVOR, so a
 * multi-lot fold collapses fully.
 *
 * Short of that threshold, ordinary lane wander (LANE_WANDER_M) still
 * turns the local bearing a few degrees between neighbouring samples,
 * which at LOT_DEPTH_M is enough for two otherwise unremarkable claims
 * (fronts comfortably spaced, nothing folded) to cross further back. That
 * is not a fold: truncate the later ordinal's depth to the bisector
 * (mirroring rule 3) rather than discard frontage the census needs, and
 * only drop it if truncation cannot leave a usable depth.
 */
export function resolveInnerCurves(lots: Lot[]): Lot[] {
  const dropped = new Set<string>();
  const depthOverride = new Map<string, number>();
  const groups = new Map<string, Lot[]>();
  for (const l of lots) {
    const key = `${l.laneId} ${l.side}`;
    const arr = groups.get(key);
    if (arr) arr.push(l); else groups.set(key, [l]);
  }
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => ordinalOf(a.id) - ordinalOf(b.id));
    const meanFrontage = sorted.reduce((s, l) => s + l.frontageM, 0) / sorted.length;
    const threshold = meanFrontage * INNER_CURVE_FRONT_RATIO;
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      if (dist(prev.front, cur.front) < threshold) {
        dropped.add(cur.id);
        continue;
      }
      const prevObb = lotObb(prev);
      if (!obbOverlap(prevObb, lotObb(cur))) {
        prev = cur;
        continue;
      }
      const clearDepth = maxDepthClearOf(cur, prevObb);
      if (clearDepth < MIN_LOT_DEPTH_M) {
        dropped.add(cur.id);
      } else {
        depthOverride.set(cur.id, clearDepth);
        prev = { ...cur, depthM: clearDepth };
      }
    }
  }
  return lots
    .filter((l) => !dropped.has(l.id))
    .map((l) => (depthOverride.has(l.id) ? { ...l, depthM: depthOverride.get(l.id)! } : l));
}

/** 0 = highest priority (always wins). The green ring outranks every lane. */
function priorityOf(laneId: string, laneTypeById: Map<string, RouteType>): number {
  if (laneId === 'green') return -1;
  const type = laneTypeById.get(laneId);
  return type ? classRank(type) : classRank('footpath');
}

/**
 * Rule 3: two lots whose (laneId, side) strips differ — different lanes,
 * opposite sides of the same lane, or the green ring against itself —
 * conflict when their claim rectangles overlap. The higher-class lane
 * keeps its lot in full; the loser is dropped if its front lies inside the
 * winner's claim, or truncated to the bisector (its depthM shortened to
 * the deepest point that clears the winner) otherwise, floored at
 * MIN_LOT_DEPTH_M — below that the lot is dropped rather than kept as a
 * sliver. Ties: nearer the green wins; still tied, lexically smaller lane
 * id; still tied (only the green-ring-vs-itself case), lexically smaller
 * lot id.
 *
 * Iterates an id-sorted copy so resolution never depends on array order,
 * then returns the surviving/truncated lots in the ORIGINAL order.
 */
function resolveCrossStrip(lots: Lot[], lanes: Lane[], green: Green): Lot[] {
  const laneTypeById = new Map<string, RouteType>(lanes.map((l) => [l.id, l.type]));
  const distToGreen = (l: Lot): number => dist(l.front, green.centre);
  // Conservative bounding radius from `front` to the claim's far corner --
  // cheap prefilter before the full SAT.
  const reach = (l: Lot): number => Math.hypot(l.frontageM / 2, l.depthM);

  const sorted = [...lots].sort((a, b) => a.id.localeCompare(b.id));
  const depthOverride = new Map<string, number>();
  const dropped = new Set<string>();
  const effective = (l: Lot): Lot => {
    const d = depthOverride.get(l.id);
    return d === undefined ? l : { ...l, depthM: d };
  };

  for (let i = 0; i < sorted.length; i++) {
    const a0 = sorted[i];
    if (dropped.has(a0.id)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b0 = sorted[j];
      if (dropped.has(b0.id)) continue;
      // Same lane, same side: handled by resolveInnerCurves, not here --
      // unless it is the green ring, whose own fold-vs-fold pairs still
      // need the SAT (mouths are pre-gapped, but the brief asks this be
      // checked rather than assumed).
      const sameStrip = a0.laneId === b0.laneId && a0.side === b0.side;
      if (sameStrip && a0.laneId !== 'green') continue;

      const a = effective(a0);
      const b = effective(b0);
      if (dist(a.front, b.front) > reach(a) + reach(b)) continue;
      if (!obbOverlap(lotObb(a), lotObb(b))) continue;

      const pa = priorityOf(a.laneId, laneTypeById);
      const pb = priorityOf(b.laneId, laneTypeById);
      let winner = a;
      let loser = b;
      if (pa !== pb) {
        if (pb < pa) { winner = b; loser = a; }
      } else {
        const da = distToGreen(a);
        const db = distToGreen(b);
        if (da !== db) {
          if (db < da) { winner = b; loser = a; }
        } else if (a.laneId !== b.laneId) {
          if (b.laneId.localeCompare(a.laneId) < 0) { winner = b; loser = a; }
        } else if (b.id.localeCompare(a.id) < 0) {
          winner = b; loser = a;
        }
      }

      const winnerObb = lotObb(winner);
      if (pointInObb(loser.front, winnerObb)) {
        dropped.add(loser.id);
        continue;
      }
      const clearDepth = maxDepthClearOf(loser, winnerObb);
      if (clearDepth < MIN_LOT_DEPTH_M) {
        dropped.add(loser.id);
      } else {
        depthOverride.set(loser.id, clearDepth);
      }
    }
  }

  return lots
    .filter((l) => !dropped.has(l.id))
    .map((l) => effective(l));
}

/**
 * The full §5.4 rules 3-4 pass: fold/wander resolution within each strip,
 * then cross-strip claim resolution. Call once per feedback round, right
 * after `clipLots`.
 */
export function resolveConvergingLots(lots: Lot[], lanes: Lane[], green: Green): Lot[] {
  return resolveCrossStrip(resolveInnerCurves(lots), lanes, green);
}
