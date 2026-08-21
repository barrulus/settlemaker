import { Point } from '../../types/point.js';
import { bearingVector, dist, inAnyWater } from '../geometry.js';
import { frontageAt, orderLots } from '../parcels/lots.js';
import { lotObb, obbOverlap, type Obb } from '../parcels/overlap.js';
import { stampEdge } from './edges.js';
import {
  CROFT_DEPTH_MAX_M, CROFT_MIN_DEPTH_M, CROFT_TIGHT_FRONTAGE_RATIO,
  GRADIENT_EXPONENT, GRADIENT_K, GRADIENT_RATIO_CAP, GREEN_JOIN_RATIO,
  LANE_SETBACK_M, RING_SETBACK_M,
} from '../constants.js';
import type {
  Building, Croft, EdgeStyle, Green, Lane, Lot,
} from '../types.js';

/** frontageAt's own ratio ceiling (frontageAt(d)/f0 when d/R hits
 * GRADIENT_RATIO_CAP) -- the "fringe" the croft ramp climbs to. */
const CROFT_MAX_RATIO = 1 + GRADIENT_K * Math.pow(GRADIENT_RATIO_CAP, GRADIENT_EXPONENT);

/**
 * §5.6/§11: 0 where the lot's frontage sits within CROFT_TIGHT_FRONTAGE_RATIO
 * of f0 (tight fronts have no gardens), rising linearly -- in the same
 * ratio space `frontageAt` itself uses -- to CROFT_DEPTH_MAX_M at the
 * gradient's own ceiling. This is the pre-clip TARGET depth; lane/green/
 * water/claim clipping in `buildCrofts` may shorten it further.
 */
export function croftDepthTarget(
  lot: Lot, green: Green, builtRadiusM: number, f0: number,
): number {
  if (f0 <= 0) return 0;
  const d = dist(lot.front, green.centre);
  const ratio = frontageAt(d, builtRadiusM, f0) / f0;
  if (ratio <= CROFT_TIGHT_FRONTAGE_RATIO) return 0;
  const span = CROFT_MAX_RATIO - CROFT_TIGHT_FRONTAGE_RATIO;
  const t = span <= 0 ? 1 : Math.min(1, (ratio - CROFT_TIGHT_FRONTAGE_RATIO) / span);
  return t * CROFT_DEPTH_MAX_M;
}

/** Tangent/normal for a lot, matching `lotObb`'s convention: `bearingDeg`
 * points AT the lane/green; `normal` is the opposite (away), the direction
 * both the claim and its croft extend. */
function lotAxes(lot: Lot): { tangent: Point; normal: Point } {
  const facing = bearingVector(lot.bearingDeg);
  const normal = new Point(-facing.x, -facing.y);
  const tangent = new Point(-facing.y, facing.x);
  return { tangent, normal };
}

/** The croft's OBB for a trial `depth`: same width as the lot, sitting
 * immediately behind the lot's claim (which is already `lot.depthM` deep). */
function croftObbAt(lot: Lot, depth: number): Obb {
  const { tangent, normal } = lotAxes(lot);
  const halfD = depth / 2;
  const centerDist = lot.depthM + halfD;
  return {
    center: new Point(lot.front.x + normal.x * centerDist, lot.front.y + normal.y * centerDist),
    tangent,
    normal,
    halfW: lot.frontageM / 2,
    halfD,
  };
}

/** Corners plus edge midpoints, a cheap-enough sample set for water/green
 * containment checks against a convex claim rectangle. */
function obbSamplePoints(obb: Obb): Point[] {
  const { center: c, tangent: t, normal: n, halfW, halfD } = obb;
  const pts: Point[] = [];
  for (const sw of [-1, 1]) {
    for (const sd of [-1, 1]) {
      pts.push(new Point(c.x + t.x * halfW * sw + n.x * halfD * sd, c.y + t.y * halfW * sw + n.y * halfD * sd));
    }
  }
  pts.push(new Point(c.x + n.x * halfD, c.y + n.y * halfD));
  pts.push(new Point(c.x - n.x * halfD, c.y - n.y * halfD));
  pts.push(new Point(c.x + t.x * halfW, c.y + t.y * halfW));
  pts.push(new Point(c.x - t.x * halfW, c.y - t.y * halfW));
  return pts;
}

/** True when `p` lies inside `obb` expanded by `margin` on both axes. */
function pointNearObb(p: Point, obb: Obb, margin: number): boolean {
  const d = new Point(p.x - obb.center.x, p.y - obb.center.y);
  const alongT = Math.abs(d.x * obb.tangent.x + d.y * obb.tangent.y);
  const alongN = Math.abs(d.x * obb.normal.x + d.y * obb.normal.y);
  return alongT <= obb.halfW + margin && alongN <= obb.halfD + margin;
}

function laneClearance(lane: Lane): number {
  return lane.widthM / 2 + (LANE_SETBACK_M[lane.type] ?? 2);
}

/** Whether `lane`'s centreline comes within its clearance of `obb`, sampled
 * every ~2 m (mirrors `subdivideGreen`'s mouth-blocking sample density). */
function laneWithinObb(obb: Obb, lane: Lane): boolean {
  if (lane.points.length < 2) return false;
  const clearance = laneClearance(lane);
  for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1];
    const b = lane.points[i];
    const segLen = dist(a, b);
    const steps = Math.max(1, Math.ceil(segLen / 2));
    for (let k = 0; k <= steps; k++) {
      const p = new Point(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
      if (pointNearObb(p, obb, clearance)) return true;
    }
  }
  return false;
}

/** The green's DRAWN edge (art fills ~87% of the box, per GREEN_JOIN_RATIO),
 * same radius `subdivideGreen` seats the ring's fronts against. */
function greenDrawnRadius(green: Green): number {
  return (green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
}

function obbNearGreen(obb: Obb, green: Green): boolean {
  const radius = greenDrawnRadius(green);
  return obbSamplePoints(obb).some((p) => dist(p, green.centre) < radius);
}

function obbHitsWater(obb: Obb, water: Point[][]): boolean {
  return obbSamplePoints(obb).some((p) => inAnyWater(p, water));
}

/**
 * The largest depth <= `target` whose croft OBB clears every lane corridor,
 * the green, water, every OTHER lot's claim, and every already-placed
 * croft (`priorObbs`, built in the same id/score-ordered walk as the
 * crofts themselves -- ties resolution to a deterministic order). ~10
 * bisections at metre precision, mirroring `overlap.ts`'s
 * `maxDepthClearOf`.
 */
function maxValidCroftDepth(
  lot: Lot, target: number, lanes: Lane[], green: Green, water: Point[][],
  otherLots: Lot[], priorObbs: Obb[],
): number {
  const valid = (depth: number): boolean => {
    if (depth <= 0) return true;
    const obb = croftObbAt(lot, depth);
    if (lanes.some((lane) => laneWithinObb(obb, lane))) return false;
    if (obbNearGreen(obb, green)) return false;
    if (obbHitsWater(obb, water)) return false;
    for (const other of otherLots) {
      if (other.id === lot.id) continue;
      if (obbOverlap(obb, lotObb(other))) return false;
    }
    for (const priorObb of priorObbs) {
      if (obbOverlap(obb, priorObb)) return false;
    }
    return true;
  };

  if (valid(target)) return target;
  let lo = 0;
  let hi = target;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (valid(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** 4 corners: [near-flank1, near-flank2, far-flank2, far-flank1] -- the
 * lot-facing edge (near1-near2) is the polygon's first edge. */
function croftPolygon(lot: Lot, depth: number): Point[] {
  const { tangent, normal } = lotAxes(lot);
  const halfW = lot.frontageM / 2;
  const near = new Point(
    lot.front.x + normal.x * lot.depthM,
    lot.front.y + normal.y * lot.depthM,
  );
  const far = new Point(near.x + normal.x * depth, near.y + normal.y * depth);
  const near1 = new Point(near.x - tangent.x * halfW, near.y - tangent.y * halfW);
  const near2 = new Point(near.x + tangent.x * halfW, near.y + tangent.y * halfW);
  const far1 = new Point(far.x - tangent.x * halfW, far.y - tangent.y * halfW);
  const far2 = new Point(far.x + tangent.x * halfW, far.y + tangent.y * halfW);
  return [near1, near2, far2, far1];
}

/** The three open sides -- both flanks plus the back -- as one polyline.
 * The lot-facing side (near1-near2) is excluded: it borders the lot's own
 * claim, not the settlement's edge. */
function croftBoundary(lot: Lot, depth: number): Point[] {
  const [near1, near2, far2, far1] = croftPolygon(lot, depth);
  return [near1, far1, far2, near2];
}

/**
 * §5.6/§7.1: one croft per BUILT lot, walked in the same score/id fill
 * order as pass 4 (`orderLots`) so truncation against already-placed
 * crofts is deterministic. An empty lot -- straggle -- gets none; neither
 * does a lot whose clipped depth truncates below CROFT_MIN_DEPTH_M.
 */
export function buildCrofts(
  lots: Lot[], buildings: Building[], green: Green, lanes: Lane[], water: Point[][],
  builtRadiusM: number, f0: number, style: EdgeStyle,
): Croft[] {
  const builtLotIds = new Set(buildings.map((b) => b.lotId));
  const ordered = orderLots(lots).filter((l) => builtLotIds.has(l.id));

  const crofts: Croft[] = [];
  const priorObbs: Obb[] = [];
  for (const lot of ordered) {
    const target = croftDepthTarget(lot, green, builtRadiusM, f0);
    if (target <= 0) continue;
    const depth = maxValidCroftDepth(lot, target, lanes, green, water, lots, priorObbs);
    if (depth < CROFT_MIN_DEPTH_M) continue;

    const id = `croft:${lot.id}`;
    const polygon = croftPolygon(lot, depth);
    const boundary = stampEdge(id, croftBoundary(lot, depth), style, lanes);
    crofts.push({ id, lotId: lot.id, polygon, depthM: depth, boundary });
    priorObbs.push(croftObbAt(lot, depth));
  }
  return crofts;
}
