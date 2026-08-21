import { Point } from '../../types/point.js';
import {
  bearingVector, dist, greenDrawnRadius, inAnyWater,
} from '../geometry.js';
import { inkExtent } from '../glyphs.js';
import { frontageAt, orderLots } from '../parcels/lots.js';
import {
  lotObb, obbOverlap, pointInObb, type Obb,
} from '../parcels/overlap.js';
import { stampEdge } from './edges.js';
import {
  CROFT_BEHIND_INK_M, CROFT_DEPTH_MAX_M, CROFT_MIN_DEPTH_M, CROFT_TIGHT_FRONTAGE_RATIO,
  GRADIENT_EXPONENT, GRADIENT_K, GRADIENT_RATIO_CAP, LANE_SETBACK_M,
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

/**
 * §5.6/V3: where the croft BEGINS, as a distance from `lot.front` along the
 * lot's inward normal -- just behind the dwelling's painted back wall
 * (`building position + ink depth / 2 + CROFT_BEHIND_INK_M`), not at the
 * abstract back of the lot.
 *
 * Fix wave (2026-08-21, V3): starting at `lot.depthM` left every garden
 * floating ~16 m clear of its own house with bare ground between them, so
 * crofts read as unattached rugs rather than as the plot's own back yard.
 * The unused ground is the lot's OWN, which is why the croft is allowed to
 * overlap its own lot's claim (same owner) and only that one -- see
 * `maxValidCroftDepth`, which already skips `lot.id` in the claim loop.
 *
 * Falls back to `lot.depthM` (the old behaviour) for a lot with no building,
 * which `buildCrofts` never asks about since it only walks BUILT lots.
 */
function croftNearOffset(lot: Lot, building: Building | undefined): number {
  if (!building) return lot.depthM;
  const { normal } = lotAxes(lot);
  const alongNormal = (building.position.x - lot.front.x) * normal.x
    + (building.position.y - lot.front.y) * normal.y;
  const back = alongNormal + inkExtent(building.glyph, building.footprint).depth / 2
    + CROFT_BEHIND_INK_M;
  return Math.min(lot.depthM, Math.max(0, back));
}

/** The croft's OBB for a trial `depth`: same width as the lot, running from
 * `nearOffset` (just behind the dwelling's ink) back to `lot.depthM + depth`
 * -- so it fills the lot's own unused ground AND the extension beyond it. */
function croftObbAt(lot: Lot, nearOffset: number, depth: number): Obb {
  const { tangent, normal } = lotAxes(lot);
  const halfD = (lot.depthM + depth - nearOffset) / 2;
  const centerDist = nearOffset + halfD;
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
      if (pointInObb(p, obb, clearance)) return true;
    }
  }
  return false;
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
  lot: Lot, nearOffset: number, target: number, lanes: Lane[], green: Green, water: Point[][],
  otherLots: Lot[], priorObbs: Obb[],
): number {
  const valid = (depth: number): boolean => {
    const obb = croftObbAt(lot, nearOffset, depth);
    if (!(obb.halfD > 0)) return true;
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
 * house-facing edge (near1-near2) is the polygon's first edge. */
function croftPolygon(lot: Lot, nearOffset: number, depth: number): Point[] {
  const { tangent, normal } = lotAxes(lot);
  const halfW = lot.frontageM / 2;
  const near = new Point(
    lot.front.x + normal.x * nearOffset,
    lot.front.y + normal.y * nearOffset,
  );
  const farDist = lot.depthM + depth;
  const far = new Point(lot.front.x + normal.x * farDist, lot.front.y + normal.y * farDist);
  const near1 = new Point(near.x - tangent.x * halfW, near.y - tangent.y * halfW);
  const near2 = new Point(near.x + tangent.x * halfW, near.y + tangent.y * halfW);
  const far1 = new Point(far.x - tangent.x * halfW, far.y - tangent.y * halfW);
  const far2 = new Point(far.x + tangent.x * halfW, far.y + tangent.y * halfW);
  return [near1, near2, far2, far1];
}

/** The three open sides -- both flanks plus the back -- as one polyline.
 * The house-facing side (near1-near2) is excluded: it runs across the
 * dwelling's own back door, not along the settlement's edge. */
function croftBoundary(lot: Lot, nearOffset: number, depth: number): Point[] {
  const [near1, near2, far2, far1] = croftPolygon(lot, nearOffset, depth);
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
  const buildingByLot = new Map(buildings.map((b) => [b.lotId, b]));
  const ordered = orderLots(lots).filter((l) => buildingByLot.has(l.id));

  const crofts: Croft[] = [];
  const priorObbs: Obb[] = [];
  for (const lot of ordered) {
    const target = croftDepthTarget(lot, green, builtRadiusM, f0);
    if (target <= 0) continue;
    const nearOffset = croftNearOffset(lot, buildingByLot.get(lot.id));
    const depth = maxValidCroftDepth(
      lot, nearOffset, target, lanes, green, water, lots, priorObbs,
    );
    if (depth < CROFT_MIN_DEPTH_M) continue;

    const id = `croft:${lot.id}`;
    const polygon = croftPolygon(lot, nearOffset, depth);
    const boundary = stampEdge(id, croftBoundary(lot, nearOffset, depth), style, lanes);
    // `depthM` stays the depth BEYOND the lot's claim -- the quantity
    // CROFT_MIN_DEPTH_M gates and the gradient targets. The polygon is
    // deeper than that by the lot's own unused back ground (V3).
    crofts.push({ id, lotId: lot.id, polygon, depthM: depth, boundary });
    priorObbs.push(croftObbAt(lot, nearOffset, depth));
  }
  return crofts;
}
