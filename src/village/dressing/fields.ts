import { fieldKinds } from '../../assets/artwork.js';
import { frontageOffsetM } from '../cross-section.js';
import { Point } from '../../types/point.js';
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { SeededRandom } from '../../utils/random.js';
import {
  bearingOf, bearingVector, closestPointOnSegment, dist, greenDrawnRadius, inAnyWater,
  wrapDeg,
} from '../geometry.js';
import { lotObb, type Obb } from '../parcels/overlap.js';
import {
  clipHalfPlane, convexHull, cutConvex, cutCorridor, extentAlong, insetConvex,
  longAxisDeg, longestEdgeDeg, polygonArea, polygonCentroid,
} from './parcel-cut.js';
import {
  FIELD_BAULK_M, FIELD_BELT_CLIP_FACTOR, FIELD_BELT_JITTER_MAX_M, FIELD_BELT_JITTER_MIN_M,
  FIELD_CLAIM_MARGIN_M, FIELD_CLEAR_SAMPLE_M, FIELD_CROPS, FIELD_TRIM_MAX_PASSES, FIELD_CUT_GAP_M, FIELD_CUT_JITTER_DEG,
  FIELD_CUT_MAX_DEPTH, FIELD_CUT_OFFSET_SPREAD, FIELD_FRINGE_CULL_CHANCE,
  FIELD_FRINGE_TOL_M, FIELD_INNER_FLOOR_PAD_M, FIELD_INNER_PERCENTILE,
  FIELD_JITTER_RANGE_DEG, FIELD_M2_PER_CAPITA, FIELD_MIN_BLOCK_AREA_M2,
  FIELD_ORCHARD_VINE_CHANCE, FIELD_PARCEL_AREA_SPREAD, FIELD_PARCEL_LEAF_FACTOR,
  FIELD_PARCEL_MIN_ASPECT, FIELD_PARCEL_TARGET_M2, FIELD_REGION_DEPTH_MAX_M,
  FIELD_REGION_DEPTH_MIN_M, FIELD_REGION_DEPTH_SPREAD, FIELD_REGION_EFFICIENCY,
  FIELD_REGION_INNER_VERTICES, FIELD_REGION_OUTER_BEARING_JITTER_DEG,
  FIELD_REGION_OUTER_VERTICES, FIELD_ROAD_FRONT_M, FIELD_ROAD_MARGIN_M,
  LANE_SETBACK_M, RING_SETBACK_M,
} from '../constants.js';
import { radialExtent, type RadialExtent } from './extent.js';
import { isApron, type Croft, type EdgeStamp, type FieldBlock, type Green, type Lane, type Lot, type Site } from '../types.js';

/**
 * §7.2, THE FARMED LAND -- rebuilt at GATE 8.3 as a PLANAR SUBDIVISION.
 *
 * What the owner said after gate 7: "we need to address the near perfect
 * circles everywhere as that is not a natural evolution." Gate 8 answered
 * it for the village BODY (a radius profile the growth itself obeys), and
 * gates 8.1 and 8.2 answered it for the ring's petals and its concentric
 * courses. Gate 8.2 then measured its own work honestly and refused half
 * its bar: the courses were gone, and the picture still had circles in it,
 * because THE FIELD FRAME WAS POLAR. The belt's inner edge was a circle,
 * its outer edge was a circle, and every parcel was an annular sector with
 * both long edges curving about the green. No jitter escapes that.
 *
 * So there is no ring here any more, and no bearing arithmetic decides the
 * shape of anything:
 *
 *  1. The farmland REGION is a polygon between two boundaries. The INNER
 *     one is the village's measured built-up edge plus a drawn belt, taken
 *     as a POLYGON (`beltPolygon`) rather than as a radius function -- so
 *     the clearing round the village is straight-sided and follows the
 *     body's own lopsidedness. The OUTER one is a coarse irregular convex
 *     hull (`regionHull`) whose depth is solved so the region holds what
 *     the census demands.
 *  2. The region is cut by ROADS first: where a lane leaves the village its
 *     corridor is taken straight out of the cell it crosses, so a road runs
 *     BETWEEN parcels rather than into the side of one.
 *  3. What is left is cut by RECURSIVE BISECTION with straight lines
 *     (`subdivide`), each cut's orientation taken from the road the cell
 *     fronts or from the cell's own long axis, jittered a few degrees and
 *     placed off centre. That is the same shape of algorithm the old city
 *     engine's `createAlleys` uses on a ward; none of its code is imported,
 *     because the village engine depends on nothing in `src/generator` or
 *     `src/wards`.
 *  4. Each leaf is clipped back out of the village (`clipOutsideBelt`),
 *     inset by a baulk, culled if it is a splinter, and ploughed along ITS
 *     OWN long axis.
 *
 * Everything here is geometric approximation by design (the brief: "modest
 * geometric approximation is fine") -- parcels are RENDERED as
 * pattern-filled polygons, not simulated farmland.
 */

/**
 * The claim's four corners IN RING ORDER.
 *
 * They used to come out in nested-loop order -- (-,-), (-,+), (+,-), (+,+)
 * -- which traces a bowtie, not a rectangle. That was harmless while the
 * only use was "how far does this claim reach", and it is NOT harmless now
 * that gate 8.3 treats a claim as a POLYGON to trim parcels against:
 * `pointInPolygon` on a self-crossing ring answers wrongly for half of it,
 * so parcels were being laid across house plots and §5.7's invariant caught
 * them.
 */
function obbCorners(obb: Obb): Point[] {
  const {
    center: c, tangent: t, normal: n, halfW, halfD,
  } = obb;
  const at = (sw: number, sd: number): Point => new Point(
    c.x + t.x * halfW * sw + n.x * halfD * sd,
    c.y + t.y * halfW * sw + n.y * halfD * sd,
  );
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/**
 * Gate 6.11 (owner: the ring must hug the village, not the plot survey):
 * only lots that CARRY A BUILDING count toward the built-up edge. Since
 * gate 6.9 the cutter tiles the whole saturated disc with plots and the
 * census fills the inner part of it, so measuring claims meant the fields
 * sat at the edge of the SURVEY -- leaving a band of open green as wide as
 * the village itself between the last house and the first furrow. Crofts
 * already exist only behind built lots, so they need no such filter.
 */
function claimBackEdgeDistances(
  green: Green, lots: Lot[], crofts: Croft[], housedLotIds?: ReadonlySet<string>,
): number[] {
  const out: number[] = [];
  for (const lot of lots) {
    if (housedLotIds && !housedLotIds.has(lot.id)) continue;
    const obb = lotObb(lot);
    let far = 0;
    for (const c of obbCorners(obb)) far = Math.max(far, dist(green.centre, c));
    out.push(far);
  }
  for (const croft of crofts) {
    if (croft.polygon.length === 0) continue;
    let far = 0;
    for (const p of croft.polygon) far = Math.max(far, dist(green.centre, p));
    out.push(far);
  }
  return out;
}

/**
 * The MEASURED fabric radius: how far the built-up edge reaches anywhere in
 * the village -- the max over every housed lot claim's and croft's back
 * edge, floored at the green's drawn radius.
 *
 * This is the "everything is inside here" number, and only stages that
 * genuinely want a single radius use it: §8.4's shorefront reach and the
 * stone circle's ring (C1).
 */
export function computeFabricRadius(
  green: Green, lots: Lot[], crofts: Croft[], housedLotIds?: ReadonlySet<string>,
): number {
  let maxR = greenDrawnRadius(green);
  for (const d of claimBackEdgeDistances(green, lots, crofts, housedLotIds)) {
    maxR = Math.max(maxR, d);
  }
  return maxR;
}

/**
 * GATE 8: every point that marks the built-up edge -- the corners of each
 * HOUSED lot claim and the vertices of each croft. `radialExtent` bins them
 * by bearing, and that is what the farmland's inner boundary and the
 * vegetation band both follow now that the body is irregular.
 */
export function builtEdgePoints(
  lots: Lot[], crofts: Croft[], housedLotIds?: ReadonlySet<string>,
): Point[] {
  const out: Point[] = [];
  for (const lot of lots) {
    if (housedLotIds && !housedLotIds.has(lot.id)) continue;
    out.push(...obbCorners(lotObb(lot)));
  }
  for (const croft of crofts) out.push(...croft.polygon);
  return out;
}

/**
 * Where the built-up edge runs, BEARING BY BEARING: a HIGH percentile
 * (FIELD_INNER_PERCENTILE) of the back-edge distances of the housed claims
 * in each bin, floored just outside the green ring, with the handful of
 * ribbon claims beyond it left outside -- which is part of what opens the
 * road passes out of the village. Gate 5's rule, gate 8's resolution.
 */
function builtEdgeExtent(
  green: Green, lots: Lot[], crofts: Croft[], housedLotIds?: ReadonlySet<string>,
): RadialExtent {
  const floor = greenDrawnRadius(green) + RING_SETBACK_M + FIELD_INNER_FLOOR_PAD_M;
  return radialExtent(
    green.centre, builtEdgePoints(lots, crofts, housedLotIds), floor, FIELD_INNER_PERCENTILE,
  );
}

/**
 * GATE 8.3: the farmland's INNER boundary, as a POLYGON.
 *
 * This is the single change that stops the village standing in a round
 * clearing. Gate 8 already measured the built-up edge per bearing and gate
 * 8.1 had the blocks walk it -- but a curve sampled every two degrees and
 * struck about the green is a circle whatever it is measured from, and at
 * pop 300, where the body is nearly round, that is exactly how it read.
 *
 * A polygon of FIELD_REGION_INNER_VERTICES vertices turns only at its
 * corners, so a parcel fronting the village fronts a STRAIGHT edge 20-30 m
 * long. Two details make that edge lean off tangential rather than reading
 * as a chord of a circle: each vertex takes the MAXIMUM of the built edge
 * over its own arc (so the polygon cannot cut inside the houses between
 * corners) and its own drawn belt from
 * [FIELD_BELT_JITTER_MIN_M, FIELD_BELT_JITTER_MAX_M], smoothed once over
 * neighbours so the clearing wanders rather than jags.
 *
 * RNG: exactly FIELD_REGION_INNER_VERTICES floats, always.
 */
export function beltPolygon(
  green: Green, edge: RadialExtent, rng: SeededRandom,
): Point[] {
  const n = FIELD_REGION_INNER_VERTICES;
  const step = 360 / n;
  const belts: number[] = [];
  for (let i = 0; i < n; i++) {
    belts.push(FIELD_BELT_JITTER_MIN_M
      + rng.float() * (FIELD_BELT_JITTER_MAX_M - FIELD_BELT_JITTER_MIN_M));
  }
  const smoothed = belts.map((_, i) => (
    (belts[(i - 1 + n) % n] + belts[i] * 2 + belts[(i + 1) % n]) / 4
  ));
  const poly: Point[] = [];
  for (let i = 0; i < n; i++) {
    const deg = i * step;
    // The maximum over the vertex's own arc, so the straight edge between
    // two corners still clears the deepest claim between them.
    let r = 0;
    for (let k = -6; k <= 6; k++) r = Math.max(r, edge.atBearing(deg + (k * step) / 12));
    const d = bearingVector(deg);
    const rad = r + smoothed[i];
    poly.push(new Point(green.centre.x + d.x * rad, green.centre.y + d.y * rad));
  }
  return poly;
}

/**
 * GATE 8.3: the farmland's OUTER boundary, and the census arithmetic.
 *
 * FIELD_REGION_OUTER_VERTICES points at jittered bearings, each pushed out
 * from the belt by the region depth times its own drawn weight, then their
 * CONVEX HULL. Coarse and irregular on purpose: 8-11 long straight sides,
 * nothing a compass would draw, and convex so that every cell of the
 * recursion below stays convex and a single half-plane clip is exact.
 *
 * The DEPTH is solved, not chosen: bisection on the scalar depth until the
 * region between the hull and the belt holds `targetAreaM2`. That is how
 * the census gets honoured -- gate 8.2 measured the old ring delivering
 * 52-54% of demand at pop 900 because FIELD_BLOCK_DEPTH_MAX_M bound long
 * before the demand was met, and a polygon region has no such structural
 * cap; FIELD_REGION_DEPTH_MAX_M is a horizon, not the operative number.
 *
 * RNG: exactly 2 * FIELD_REGION_OUTER_VERTICES floats, always.
 */
export function regionHull(
  green: Green, belt: Point[], targetAreaM2: number, rng: SeededRandom,
): Point[] {
  const n = FIELD_REGION_OUTER_VERTICES;
  const bearings: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    bearings.push(wrapDeg((i * 360) / n
      + (rng.float() * 2 - 1) * FIELD_REGION_OUTER_BEARING_JITTER_DEG));
    weights.push(1 + (rng.float() * 2 - 1) * FIELD_REGION_DEPTH_SPREAD);
  }
  // How far the belt reaches at each of those bearings: the maximum over
  // the belt's own vertices near that bearing, so the hull cannot be laid
  // inside the clearing.
  const baseR = bearings.map((deg) => {
    let r = 0;
    for (const p of belt) {
      const d = Math.abs(((bearingOf(green.centre, p) - deg + 540) % 360) - 180);
      if (d < 360 / n) r = Math.max(r, dist(green.centre, p));
    }
    if (r === 0) for (const p of belt) r = Math.max(r, dist(green.centre, p));
    return r;
  });
  const beltArea = polygonArea(belt);
  const hullAt = (depth: number): Point[] => convexHull(bearings.map((deg, i) => {
    const d = bearingVector(deg);
    const rad = baseR[i] + depth * weights[i];
    return new Point(green.centre.x + d.x * rad, green.centre.y + d.y * rad);
  }));
  let lo = FIELD_REGION_DEPTH_MIN_M;
  let hi = FIELD_REGION_DEPTH_MAX_M;
  if (polygonArea(hullAt(hi)) - beltArea <= targetAreaM2) return hullAt(hi);
  if (polygonArea(hullAt(lo)) - beltArea >= targetAreaM2) return hullAt(lo);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (polygonArea(hullAt(mid)) - beltArea < targetAreaM2) lo = mid; else hi = mid;
  }
  return hullAt((lo + hi) / 2);
}

/** A road as the subdivision sees it: an infinite straight line with a
 * corridor either side of it, and the side of the village it serves. */
interface RoadLine {
  p: Point;
  dirDeg: number;
  halfWidthM: number;
  /** Unit vector pointing OUTWARD along the road from the green. A cell is
   * only cut by this road if it lies on that side -- otherwise the line,
   * which is infinite, would carve a phantom track through the fields on
   * the far side of the village where no road runs. */
  outX: number;
  outY: number;
}

/**
 * The roads that leave the village, as straight lines with corridors. Taken
 * from each green-attached lane's OUTERMOST segment, which is the part that
 * actually crosses the farmland (gate 8's concern 6: an arm leaves the body
 * on a dead straight line, so the line is a faithful description of it).
 */
export function exitRoads(green: Green, lanes: Lane[], belt: Point[]): RoadLine[] {
  const aprons = lanes.filter((l) => isApron(l.id) && l.points.length >= 1);
  // Matched by GEOMETRY, not by stripping the apron id back to its trunk's
  // base id. `growAprons` computes an apron's id from `rehomed.trunks`,
  // BEFORE the combined `resolveCrossings(withAprons, ...)` call -- so if
  // crossing resolution later splits the trunk that owns an apron, the
  // outer half (the one carrying the tip and the contract entry) is
  // renamed `T~xB`, and an id-strip match on the apron's `T/a` id would
  // miss it, cutting a second field corridor from the tip the apron
  // already leaves from -- the exact double corridor this exclusion
  // exists to prevent, arriving from the other direction. The apron's
  // first vertex is a `clone()` of its trunk's own tip (spec §5.3), so a
  // coincidence test survives any renaming a crossing split does.
  const hasApron = (lane: Lane): boolean => {
    if (lane.points.length === 0) return false;
    const tip = lane.points[lane.points.length - 1];
    return aprons.some((a) => dist(a.points[0], tip) <= 1e-6);
  };
  const out: RoadLine[] = [];
  for (const lane of lanes) {
    if (lane.parentId !== undefined) continue;
    if (hasApron(lane)) continue; // its apron is the exit road
    if (lane.points.length < 2) continue;
    const tip = lane.points[lane.points.length - 1];
    const prev = lane.points[lane.points.length - 2];
    // Only lanes that actually reach the farmland.
    if (!pointInPolygon(tip, belt)) {
      const dirDeg = bearingOf(prev, tip);
      const d = bearingVector(dirDeg);
      out.push({
        p: tip,
        dirDeg,
        halfWidthM: frontageOffsetM(lane) + FIELD_ROAD_MARGIN_M,
        outX: d.x,
        outY: d.y,
      });
    }
  }
  return out;
}

/**
 * Everything a parcel must keep off, precomputed once per village.
 *
 * The polar frame tested one point at a time against every lot, croft and
 * lane in the settlement; a planar subdivision asks the same question far
 * more often (every parcel is walked along its edges, and a parcel that
 * fouls something is TRIMMED rather than dropped, which means asking
 * again), so each obstacle carries a bounding circle and the walk skips
 * anything out of reach.
 */
interface Obstacle {
  /** Convex outline: an OBB's four corners, or a croft's own polygon. */
  poly: Point[];
  centre: Point;
  radiusM: number;
}
interface LaneSeg {
  a: Point;
  b: Point;
  clearanceM: number;
}
interface Obstacles {
  claims: Obstacle[];
  segs: LaneSeg[];
  water: Point[][];
}

function buildObstacles(lots: Lot[], crofts: Croft[], lanes: Lane[], water: Point[][]): Obstacles {
  const claims: Obstacle[] = [];
  const add = (poly: Point[]): void => {
    if (poly.length < 3) return;
    const c = polygonCentroid(poly);
    let r = 0;
    for (const p of poly) r = Math.max(r, dist(c, p));
    claims.push({ poly, centre: c, radiusM: r });
  };
  for (const lot of lots) add(obbCorners(lotObb(lot)));
  for (const croft of crofts) add(croft.polygon);
  const segs: LaneSeg[] = [];
  for (const lane of lanes) {
    const clearanceM = frontageOffsetM(lane);
    for (let i = 1; i < lane.points.length; i++) {
      segs.push({ a: lane.points[i - 1], b: lane.points[i], clearanceM });
    }
  }
  return { claims, segs, water };
}

/**
 * What is standing on this point, if anything: the claim it is inside, the
 * lane corridor it is inside, or `water` (which cannot be trimmed against,
 * water rings being neither convex nor few).
 */
function blockerAt(
  p: Point, obs: Obstacles,
): { kind: 'claim'; obstacle: Obstacle; } | { kind: 'lane'; seg: LaneSeg; } | { kind: 'water'; } | null {
  if (inAnyWater(p, obs.water)) return { kind: 'water' };
  for (const claim of obs.claims) {
    if (dist(p, claim.centre) > claim.radiusM + FIELD_CLAIM_MARGIN_M) continue;
    // Inside, or close enough to it that §5.7's 0.25 m overlap slack would
    // call it inside. The test margin is HALF the cut margin, so the edge a
    // trim leaves behind reads as clear on the next pass instead of being
    // trimmed again forever.
    if (pointInPolygon(p, claim.poly)
      || distToBoundary(p, claim.poly) <= FIELD_CLAIM_MARGIN_M / 2) {
      return { kind: 'claim', obstacle: claim };
    }
  }
  for (const seg of obs.segs) {
    if (dist(p, closestPointOnSegment(p, seg.a, seg.b)) <= seg.clearanceM) {
      return { kind: 'lane', seg };
    }
  }
  return null;
}

/** Every point a parcel is judged on: its vertices, its edges at
 * FIELD_CLEAR_SAMPLE_M, and its centroid (which catches a parcel small
 * enough to sit wholly inside one claim). */
function parcelSamples(poly: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const steps = Math.max(1, Math.ceil(dist(a, b) / FIELD_CLEAR_SAMPLE_M));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push(new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }
  out.push(polygonCentroid(poly));
  return out;
}

/** The first sample that is standing on something, with what it is. */
function firstBlocker(
  poly: Point[], obs: Obstacles,
): { at: Point; blocker: NonNullable<ReturnType<typeof blockerAt>>; } | null {
  for (const p of parcelSamples(poly)) {
    const blocker = blockerAt(p, obs);
    if (blocker !== null) return { at: p, blocker };
  }
  return null;
}

/**
 * GATE 8.3: a parcel that fouls a claim or a lane is TRIMMED, not dropped.
 *
 * The polar frame clipped a slot bearing by bearing, so a road or a deep
 * ribbon lot took a bite out of a block and the rest of it survived. A
 * straight-cut parcel has no such natural seam, and the first draft simply
 * rejected any parcel with one bad sample -- which cost a whole ring of
 * parcels round the village, because FIELD_INNER_PERCENTILE deliberately
 * leaves the deepest fifteen per cent of claims OUTSIDE the belt. The
 * render showed it as a wide empty lawn between the last house and the
 * first furrow, which is the exact verdict gate 5.3 was set to fix.
 *
 * So the obstacle is cut away with a straight line instead: the half-plane,
 * among the obstacle's own sides, that excludes the offending point and
 * keeps the most parcel. The parcel stays convex, its new edge is straight
 * and lies along a house plot or a lane -- which is what a field boundary
 * against a village does -- and the census keeps the ground.
 *
 * Water is the exception and is still a rejection: a water ring is neither
 * convex nor local, and no single half-plane describes a shoreline.
 */
function trimToClearGround(poly: Point[], obs: Obstacles): Point[] {
  let cur = poly;
  for (let pass = 0; pass < FIELD_TRIM_MAX_PASSES; pass++) {
    const found = firstBlocker(cur, obs);
    if (found === null) return cur;
    if (found.blocker.kind === 'water') return [];
    const cands: Array<{ nx: number; ny: number; c: number; }> = [];
    if (found.blocker.kind === 'claim') {
      const cp = found.blocker.obstacle.poly;
      let sgn = 0;
      for (let i = 0; i < cp.length; i++) {
        const a = cp[i];
        const b = cp[(i + 1) % cp.length];
        sgn += a.x * b.y - b.x * a.y;
      }
      const sign = sgn >= 0 ? 1 : -1;
      for (let i = 0; i < cp.length; i++) {
        const a = cp[i];
        const b = cp[(i + 1) % cp.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-9) continue;
        // Inward normal of the claim's edge: keep the ground OUTSIDE it.
        const nx = (-sign * (b.y - a.y)) / len;
        const ny = (sign * (b.x - a.x)) / len;
        cands.push({ nx, ny, c: nx * a.x + ny * a.y - FIELD_CLAIM_MARGIN_M });
      }
    } else {
      const { a, b, clearanceM } = found.blocker.seg;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) return [];
      const dx = (b.x - a.x) / len;
      const dy = (b.y - a.y) / len;
      // The corridor is a capsule; the four straight sides of the slab and
      // its two ends are the lines a field boundary could run along.
      // Cut a margin CLEAR of the corridor, not exactly on it: a cut placed
      // on the corridor's own line leaves vertices at exactly the clearance,
      // which `blockerAt` reads as still inside, and the parcel would be
      // trimmed again every pass until it was given up on.
      const w = clearanceM + FIELD_CLAIM_MARGIN_M;
      cands.push({ nx: dy, ny: -dx, c: dy * a.x - dx * a.y - w });
      cands.push({ nx: -dy, ny: dx, c: -dy * a.x + dx * a.y - w });
      cands.push({ nx: dx, ny: dy, c: dx * a.x + dy * a.y - w });
      cands.push({ nx: -dx, ny: -dy, c: -(dx * b.x + dy * b.y) - w });
    }
    let best: Point[] = [];
    let bestArea = 0;
    for (const cand of cands) {
      // The cut must actually exclude the point that was blocked.
      if (cand.nx * found.at.x + cand.ny * found.at.y <= cand.c + 1e-9) continue;
      const clipped = clipHalfPlane(cur, cand.nx, cand.ny, cand.c);
      const area = clipped.length >= 3 ? polygonArea(clipped) : 0;
      if (area > bestArea) { bestArea = area; best = clipped; }
    }
    if (best.length < 3) return [];
    cur = best;
  }
  return firstBlocker(cur, obs) === null ? cur : [];
}

/**
 * GATE 8.3: take the village out of a cell.
 *
 * The belt polygon is star-shaped about the green but not convex, so this
 * is not a single clip -- and it must not be an INTERSECTION of clips
 * either. The first draft cut the cell by the outward half-plane of every
 * belt edge that touched it, which is right for a cell straddling one edge
 * and badly wrong for a cell sitting off a belt CORNER: the region outside
 * a convex polygon is not convex, so intersecting two adjacent outward
 * half-planes takes the whole corner away. Eighteen corners each scalloped
 * out is a wide empty lawn round the village -- gate 5.3's verdict again,
 * and the first render of this gate showed it plainly.
 *
 * So the cut is GREEDY and one line at a time: while any part of the cell
 * is still inside the belt, take the single touching edge whose outward
 * half-plane excludes an offending point and keeps the most parcel. A cell
 * wholly inside the village runs out of ground and is dropped; a cell
 * wholly outside is returned untouched; a cell across the boundary comes
 * back with one or two straight edges lying along the village's own.
 */
export function clipOutsideBelt(cell: Point[], belt: Point[]): Point[] {
  // Orientation of the belt decides which way "outward" is.
  let s = 0;
  for (let i = 0; i < belt.length; i++) {
    const a = belt[i];
    const b = belt[(i + 1) % belt.length];
    s += a.x * b.y - b.x * a.y;
  }
  const sign = s >= 0 ? 1 : -1;
  let cur = cell;
  for (let pass = 0; pass < FIELD_TRIM_MAX_PASSES; pass++) {
    // Any sample inside the village at all?
    let inside: Point | null = null;
    for (const p of parcelSamples(cur)) {
      if (pointInPolygon(p, belt)) { inside = p; break; }
    }
    if (inside === null) return cur;
    let best: Point[] = [];
    let bestArea = 0;
    for (let i = 0; i < belt.length; i++) {
      const a = belt[i];
      const b = belt[(i + 1) % belt.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (len < 1e-9) continue;
      // Inward normal: clipping to `n.p <= c` keeps the ground on the far
      // side of this edge from the green.
      const nx = (-sign * ey) / len;
      const ny = (sign * ex) / len;
      const c = nx * a.x + ny * a.y;
      if (nx * inside.x + ny * inside.y <= c + 1e-9) continue;
      const clipped = clipHalfPlane(cur, nx, ny, c);
      const area = clipped.length >= 3 ? polygonArea(clipped) : 0;
      if (area > bestArea) { bestArea = area; best = clipped; }
    }
    if (best.length < 3) return [];
    cur = best;
  }
  return cur;
}

/** The road whose line runs nearest this cell, and how far off it is. */
function nearestRoad(cell: Point[], roads: RoadLine[]): { road: RoadLine; distM: number; } | null {
  if (roads.length === 0) return null;
  const c = polygonCentroid(cell);
  let best: { road: RoadLine; distM: number; } | null = null;
  for (const road of roads) {
    if ((c.x - road.p.x) * road.outX + (c.y - road.p.y) * road.outY < -road.halfWidthM) continue;
    const r = ((road.dirDeg + 90) * Math.PI) / 180;
    const nx = Math.sin(r);
    const ny = -Math.cos(r);
    const d = Math.abs(nx * (c.x - road.p.x) + ny * (c.y - road.p.y));
    if (best === null || d < best.distM) best = { road, distM: d };
  }
  return best;
}

/** Does this road's corridor actually cut through the cell? */
function roadCrosses(cell: Point[], road: RoadLine): boolean {
  const r = ((road.dirDeg + 90) * Math.PI) / 180;
  const nx = Math.sin(r);
  const ny = -Math.cos(r);
  const at = nx * road.p.x + ny * road.p.y;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of cell) {
    const t = nx * p.x + ny * p.y;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  if (lo >= at + road.halfWidthM || hi <= at - road.halfWidthM) return false;
  // And the cell must lie on the road's OWN side of the village.
  const c = polygonCentroid(cell);
  return (c.x - road.p.x) * road.outX + (c.y - road.p.y) * road.outY > -road.halfWidthM * 2;
}

/** Fold `deg` into [0, 180) -- a cut orientation is undirected. */
function fold180(deg: number): number {
  return ((deg % 180) + 180) % 180;
}

/** The signed difference between two undirected orientations, in
 * (-90, 90]. */
function orientDelta(a: number, b: number): number {
  return ((fold180(a - b) + 90) % 180) - 90;
}

/**
 * GATE 8.3: the recursive bisection.
 *
 * A cell spends exactly THREE floats before anything else happens to it --
 * angle jitter, cut position, and the size target that decides whether it
 * is a leaf -- whatever it turns out to be. Nothing downstream (the clip
 * against the village, the culls, the clear-ground walk) can move a draw,
 * which is the same discipline every stage in this engine keeps: the rng
 * sequence follows the RECURSION, which is a function of the region's own
 * geometry, never of what survives.
 *
 * Where the cut comes from, in order of preference:
 *  - a ROAD whose corridor crosses the cell: the cell is split by the
 *    corridor itself, so the road ends up between parcels with its verge
 *    showing, which is what the old ring achieved with angular gaps;
 *  - a road within FIELD_ROAD_FRONT_M: the cut takes the road's own
 *    bearing, or its perpendicular -- whichever is nearer the cell's long
 *    axis -- so the parcels along a road front onto it;
 *  - otherwise the cell's LONG AXIS, so a cut always halves the longer
 *    dimension and the patchwork does not drift into ribbons.
 */
function subdivide(
  cell0: Point[], depth: number, belt: Point[], roads: RoadLine[],
  rng: SeededRandom, out: Point[][],
): void {
  const jitterRoll = rng.float();
  const offsetRoll = rng.float();
  const sizeRoll = rng.float();
  // The village is taken out of the cell AT EVERY LEVEL, not only at the
  // leaves. Clipping only at the end left every parcel that straddled the
  // belt losing most of its area and then failing the culls, so the
  // apparent belt was the drawn belt PLUS a whole parcel width -- a wide
  // lawn round the village, which is exactly the verdict gate 5.3 was set
  // to fix. Clipped here, the ground stays in the subdivision and gets cut
  // into parcels that front the village. `clipOutsideBelt` only ever
  // intersects half-planes, so the cell stays convex.
  //
  // The size threshold below is the one thing that makes this sound.
  const area0 = polygonArea(cell0);
  if (area0 < 1e-6) return;
  // ...but only once the cell is PARCEL-SIZED. `clipOutsideBelt` reads the
  // belt as a handful of local half-planes, which is true of a cell a
  // parcel or two across and false of the whole region: the first draft
  // clipped at every level and the region -- which contains the entire belt
  // -- was cut by all eighteen of its inward half-planes at once and came
  // back empty, so the village drew no fields at all. Above the threshold
  // the cell is left alone and simply subdivided; nothing is lost, because
  // every descendant passes through here.
  const cell = area0 <= FIELD_PARCEL_TARGET_M2 * FIELD_BELT_CLIP_FACTOR
    ? clipOutsideBelt(cell0, belt)
    : cell0;
  if (cell.length < 3) return;
  const area = polygonArea(cell);
  if (area < 1e-6) return;

  if (depth < FIELD_CUT_MAX_DEPTH) {
    for (const road of roads) {
      if (!roadCrosses(cell, road)) continue;
      const pieces = cutCorridor(cell, road.p, road.dirDeg, road.halfWidthM);
      // A corridor that swallows the cell whole leaves nothing, and that is
      // correct: the cell WAS the road.
      const rest = roads.filter((r) => r !== road);
      for (const piece of pieces) subdivide(piece, depth + 1, belt, rest, rng, out);
      return;
    }
  }

  const target = FIELD_PARCEL_TARGET_M2 * (1 + (sizeRoll * 2 - 1) * FIELD_PARCEL_AREA_SPREAD);
  if (area <= target * FIELD_PARCEL_LEAF_FACTOR || depth >= FIELD_CUT_MAX_DEPTH) {
    out.push(cell);
    return;
  }

  // The cut runs ACROSS the longest edge, which is what keeps the pieces
  // blocky (see `longestEdgeDeg`). The long axis is the tie-breaker the
  // road rule is judged against, because "which way is this cell long" is
  // the question "should the parcels here front the road or lie behind it"
  // reduces to.
  const axis = longAxisDeg(cell);
  let normalDeg = longestEdgeDeg(cell);
  const near = nearestRoad(cell, roads);
  if (near !== null && near.distM <= FIELD_ROAD_FRONT_M) {
    const a = near.road.dirDeg;
    const b = near.road.dirDeg + 90;
    normalDeg = Math.abs(orientDelta(a, axis)) <= Math.abs(orientDelta(b, axis)) ? a : b;
  }
  normalDeg += (jitterRoll * 2 - 1) * FIELD_CUT_JITTER_DEG;
  const t = 0.5 + (offsetRoll - 0.5) * FIELD_CUT_OFFSET_SPREAD;
  const pieces = cutConvex(cell, normalDeg, t, FIELD_CUT_GAP_M);
  if (pieces.length < 2) {
    out.push(cell);
    return;
  }
  for (const piece of pieces) subdivide(piece, depth + 1, belt, roads, rng, out);
}

/** Shortest distance from `p` to the polygon's boundary. */
function distToBoundary(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)));
  }
  return best;
}

export interface FieldsResult {
  innerBoundary?: Point[];
  blocks: FieldBlock[];
  /** Gate 5: EMPTY. Parcels carry no outline -- no hedge, wall, fence or
   * ditch anywhere on a field. Kept on the result (and threaded to
   * `VillageModel.fieldEdges`, and painted by the renderer) so the edge
   * machinery stays wired up for a future design that wants it back. */
  edges: EdgeStamp[];
  /** The OUTERMOST radius any kept parcel reaches -- the measured fabric
   * radius when no parcel was kept at all. */
  outerRadius: number;
  /**
   * GATE 8.3: the farmland REGION's own outer boundary, as a polygon.
   *
   * Vegetation used to measure the tree line off the field polygons
   * themselves, which was right while the ring's outer edge was continuous
   * and wrong the moment it stopped being: gate 8.2 stepped that edge per
   * slot and the band's rim ratio went to 3.8-6.4, and a fringe cull (which
   * this gate wants, for a ragged outer edge) would have been worse again,
   * because a bearing whose fringe parcel was culled falls all the way back
   * to the houses. The REGION is the honest answer to "where does the
   * farmed land end" -- still measured geometry, not a prediction: it is
   * the polygon that was actually subdivided.
   */
  regionPolygon: Point[];
}

/**
 * §7.2: the whole field system for one village.
 *
 * RNG, in order, and every count fixed independently of geometry except the
 * recursion itself (which is a function of the region, not of what
 * survives):
 *   1. FIELD_REGION_INNER_VERTICES floats -- the belt polygon.
 *   2. 2 * FIELD_REGION_OUTER_VERTICES floats -- the region hull.
 *   3. 3 floats per cell of the bisection, in pre-order.
 *   4. 3 floats per leaf -- crop roll, furrow jitter, fringe-cull roll --
 *      spent whether or not the leaf survives the clip and the culls.
 *
 * Never throws. An empty result means the region was walled off entirely
 * (water, claims, corridors) or every parcel was culled.
 */
export function buildFields(
  site: Site, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], rng: SeededRandom,
  housedLotIds?: ReadonlySet<string>,
): FieldsResult {
  const fabricRadius = computeFabricRadius(green, lots, crofts, housedLotIds);
  const edge = builtEdgeExtent(green, lots, crofts, housedLotIds);

  const belt = beltPolygon(green, edge, rng);
  const demand = Math.max(0, site.population) * FIELD_M2_PER_CAPITA;
  const region = regionHull(green, belt, demand / FIELD_REGION_EFFICIENCY, rng);

  const obstacles = buildObstacles(lots, crofts, lanes, site.water);
  const roads = exitRoads(green, lanes, belt);
  const leaves: Point[][] = [];
  subdivide(region, 0, belt, roads, rng, leaves);

  const crops = fieldKinds(site.biome, site.biome === 'desert' || site.water.length > 0);
  if (!crops.length) return { blocks: [], edges: [], outerRadius: fabricRadius, regionPolygon: region };

  const blocks: FieldBlock[] = [];
  let outerRadius = fabricRadius;
  let ordinal = 0;
  for (const leaf of leaves) {
    rng.float(); // Preserve the crop draw in the independent dressing stream.
    const furrowRoll = rng.float();
    const fringeRoll = rng.float();

    // `subdivide` has already taken the village out of every cell small
    // enough for the local clip to be sound; this catches the rare leaf
    // that came out of a corridor cut above that size.
    const clipped = clipOutsideBelt(leaf, belt);
    if (clipped.length < 3) continue;
    const parcel = insetConvex(clipped, FIELD_BAULK_M);
    if (parcel.length < 3) continue;
    if (polygonArea(parcel) < FIELD_MIN_BLOCK_AREA_M2) continue;
    // The fringe cull: a fifth of the parcels standing on the region's own
    // outer boundary are dropped, so the farmland ends raggedly against the
    // waste rather than being drawn out flush along a straight hull side.
    if (fringeRoll < FIELD_FRINGE_CULL_CHANCE
      && parcel.some((p) => distToBoundary(p, region) <= FIELD_BAULK_M + FIELD_FRINGE_TOL_M)) continue;
    const cleared = trimToClearGround(parcel, obstacles);
    if (cleared.length < 3) continue;
    const clearArea = polygonArea(cleared);
    if (clearArea < FIELD_MIN_BLOCK_AREA_M2) continue;

    // A splinter -- the offcut left beside a road corridor, a claim or the
    // belt -- measured on the TRIMMED parcel, which is the shape drawn.
    const axis = longAxisDeg(cleared);
    const along = extentAlong(cleared, axis);
    const across = extentAlong(cleared, axis + 90);
    const lengthM = along.hi - along.lo;
    const widthM = across.hi - across.lo;
    if (!(lengthM > 0) || widthM < FIELD_PARCEL_MIN_ASPECT * lengthM) continue;

    const furrow = wrapDeg(axis + furrowRoll * FIELD_JITTER_RANGE_DEG - FIELD_JITTER_RANGE_DEG / 2);
    blocks.push({
      id: `field:P${ordinal}`,
      furlongId: `furlong:${Math.floor(bearingOf(green.centre, polygonCentroid(cleared)) / 30)}`,
      glyph: crops[ordinal % crops.length],
      polygon: cleared,
      furrowBearingDeg: furrow,
      areaM2: clearArea,
    });
    ordinal += 1;
    for (const p of cleared) outerRadius = Math.max(outerRadius, dist(green.centre, p));
  }

  return {
    blocks, edges: [], outerRadius, regionPolygon: region, ...(site.flags.walls ? {innerBoundary:belt}:{}),
  };
}
