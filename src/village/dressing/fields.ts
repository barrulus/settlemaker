import { Point } from '../../types/point.js';
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { SeededRandom } from '../../utils/random.js';
import {
  angularGap, bearingOf, bearingVector, dist, greenDrawnRadius, inAnyWater,
  withinLaneCorridor, wrapDeg,
} from '../geometry.js';
import { lotObb, pointInObb, type Obb } from '../parcels/overlap.js';
import {
  FIELD_BELT_GAP_M, FIELD_BELT_JITTER_MAX_M, FIELD_BELT_JITTER_MIN_M,
  FIELD_BLOCK_DEPTH_MAX_M, FIELD_BLOCK_DEPTH_MIN_M, FIELD_DEPTH_JITTER,
  FIELD_SKEW_JITTER, FIELD_SPAN_JITTER,
  FIELD_BLOCK_GAP_SHARE, FIELD_BLOCK_MAX_PER_WEDGE, FIELD_BLOCK_SLICE_DEG,
  FIELD_BLOCK_SPAN_TARGET_DEG, FIELD_CROPS, FIELD_FURROW_MIN_SEPARATION_DEG,
  FIELD_INNER_FLOOR_PAD_M, FIELD_INNER_PERCENTILE, FIELD_JITTER_RANGE_DEG,
  FIELD_M2_PER_CAPITA, FIELD_MIN_BLOCK_AREA_M2, FIELD_ORCHARD_VINE_CHANCE,
  FIELD_WEDGE_CLAIM_MARGIN_DEG, EXTENT_BIN_DEG, LANE_SETBACK_M, RING_SETBACK_M,
} from '../constants.js';
import { radialExtent, type RadialExtent } from './extent.js';
import type {
  Croft, EdgeStamp, FieldBlock, Green, Lane, Lot, Site,
} from '../types.js';

/**
 * §7.2: the census-eating field system -- since gate 5 (2026-08-22), a RING
 * of large chunky blocks laid AROUND the whole settlement, separated from
 * the fabric by an open green belt, with the roads passing out between the
 * blocks. Owner's verdict on the previous design (12 m furlong strips woven
 * through the fabric, hedge-stamped): "you'd have fields AROUND the
 * village, not INSIDE the village."
 *
 * The structure that survives from before: wedges (angular sectors between
 * adjacent green-attached lanes), a per-wedge inner radius measured off the
 * sector's own claims, census-driven area, and the furrow-bearing
 * constraint walk. What changed: a wedge's ring segment is cut into 1-3
 * chunky annular-sector BLOCKS with open green gaps between them, each a
 * single pattern-filled polygon carrying one crop and one furrow bearing.
 * The ploughed texture is the crop tile's own; nothing is outlined.
 *
 * Everything here is geometric approximation by design (the brief: "modest
 * geometric approximation is fine") -- blocks are RENDERED as pattern-filled
 * polygons, not simulated farmland, so clipping by angular slice reads
 * correctly at village scale.
 */

export interface Wedge {
  id: string;
  /** Clockwise sweep start, degrees. */
  bearingA: number;
  /** Clockwise sweep width, degrees; 360 for the fail-soft single-wedge
   * cases (0 or 1 green-attached lanes), which then skip the angle test
   * entirely. */
  spanDeg: number;
  bisectorDeg: number;
}

/** Same notion `skeleton/lanes.ts` uses: a lane leaving the green directly,
 * as opposed to one branching off another lane. */
function isGreenAttachedLane(lane: Lane): boolean {
  return lane.parentId === undefined && lane.points.length > 0;
}

/**
 * The angular sectors between adjacent green-attached lanes, sorted by
 * bearing from the green centre. Fewer than 2 such lanes cannot bound a
 * sector at all -- §8.5 fail-soft: one full-circle "wedge" covers the
 * whole village instead of throwing.
 */
export function buildWedges(green: Green, lanes: Lane[]): Wedge[] {
  const attached = lanes.filter(isGreenAttachedLane);
  if (attached.length === 0) {
    return [{
      id: 'wedge:none', bearingA: 0, spanDeg: 360, bisectorDeg: 0,
    }];
  }
  if (attached.length === 1) {
    const b = bearingOf(green.centre, attached[0].points[0]);
    return [{
      id: `wedge:${attached[0].id}|${attached[0].id}`,
      bearingA: b,
      spanDeg: 360,
      bisectorDeg: wrapDeg(b + 180),
    }];
  }

  const withBearing = attached
    .map((l) => ({ lane: l, bearing: bearingOf(green.centre, l.points[0]) }))
    .sort((a, b) => a.bearing - b.bearing);
  const n = withBearing.length;
  const wedges: Wedge[] = [];
  for (let i = 0; i < n; i++) {
    const a = withBearing[i];
    const b = withBearing[(i + 1) % n];
    const span = wrapDeg(b.bearing - a.bearing);
    if (span <= 1e-6) continue; // duplicate bearings: degenerate, no wedge
    wedges.push({
      id: `wedge:${a.lane.id}|${b.lane.id}`,
      bearingA: a.bearing,
      spanDeg: span,
      bisectorDeg: wrapDeg(a.bearing + span / 2),
    });
  }
  if (wedges.length === 0) {
    return [{
      id: 'wedge:none', bearingA: 0, spanDeg: 360, bisectorDeg: 0,
    }];
  }
  return wedges;
}

function obbCorners(obb: Obb): Point[] {
  const {
    center: c, tangent: t, normal: n, halfW, halfD,
  } = obb;
  const pts: Point[] = [];
  for (const sw of [-1, 1]) {
    for (const sd of [-1, 1]) {
      pts.push(new Point(c.x + t.x * halfW * sw + n.x * halfD * sd, c.y + t.y * halfW * sw + n.y * halfD * sd));
    }
  }
  return pts;
}

function centroid(points: Point[]): Point {
  let sx = 0;
  let sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return new Point(sx / points.length, sy / points.length);
}

/** Whether `p`'s bearing from the green centre falls inside `wedge`'s
 * angular span, widened by FIELD_WEDGE_CLAIM_MARGIN_DEG at both ends. A
 * full-circle fail-soft wedge (spanDeg 360) contains everything. */
function bearingInWedge(p: Point, green: Green, wedge: Wedge): boolean {
  if (wedge.spanDeg >= 359.999) return true;
  const rel = wrapDeg(bearingOf(green.centre, p) - wedge.bearingA + FIELD_WEDGE_CLAIM_MARGIN_DEG);
  return rel <= wedge.spanDeg + 2 * FIELD_WEDGE_CLAIM_MARGIN_DEG;
}

/**
 * How far a claim's BACK EDGE reaches from the green: the farthest of its
 * own corners (a lot claim) or vertices (a croft). One number per claim,
 * which is what the percentile below ranks.
 */
/**
 * Gate 6.11 (owner: the ring must hug the village, not the plot survey):
 * only lots that CARRY A BUILDING count toward the built-up edge. Since
 * gate 6.9 the cutter tiles the whole saturated disc with plots and the
 * census fills the inner part of it, so measuring claims meant the ring
 * sat at the edge of the SURVEY — leaving a band of open green as wide as
 * the village itself between the last house and the first furrow. Crofts
 * already exist only behind built lots, so they need no such filter.
 */
function claimBackEdgeDistances(
  green: Green, lots: Lot[], crofts: Croft[], wedge?: Wedge,
  housedLotIds?: ReadonlySet<string>,
): number[] {
  const out: number[] = [];
  for (const lot of lots) {
    if (housedLotIds && !housedLotIds.has(lot.id)) continue;
    const obb = lotObb(lot);
    if (wedge && !bearingInWedge(obb.center, green, wedge)) continue;
    let far = 0;
    for (const c of obbCorners(obb)) far = Math.max(far, dist(green.centre, c));
    out.push(far);
  }
  for (const croft of crofts) {
    if (croft.polygon.length === 0) continue;
    if (wedge && !bearingInWedge(centroid(croft.polygon), green, wedge)) continue;
    let far = 0;
    for (const p of croft.polygon) far = Math.max(far, dist(green.centre, p));
    out.push(far);
  }
  return out;
}

/**
 * The MEASURED fabric radius: how far the built-up edge reaches anywhere in
 * the village -- the max over every lot claim's and croft's back edge,
 * floored at the green's drawn radius.
 *
 * This is the "everything is inside here" number, and only stages that need
 * that use it: the vegetation ramp's fallback when there are no fields at
 * all, §8.4's shorefront reach, and the stone circle's ring (C1). It is
 * explicitly NOT what a wedge's field band starts at -- see
 * `wedgeInnerRadius`.
 */
export function computeFabricRadius(
  green: Green, lots: Lot[], crofts: Croft[], housedLotIds?: ReadonlySet<string>,
): number {
  let maxR = greenDrawnRadius(green);
  for (const d of claimBackEdgeDistances(green, lots, crofts, undefined, housedLotIds)) {
    maxR = Math.max(maxR, d);
  }
  return maxR;
}

/**
 * Where the ring's inner edge runs, BEARING BY BEARING.
 *
 * The percentile rule is gate 5's and unchanged: a HIGH percentile
 * (FIELD_INNER_PERCENTILE) of the back-edge distances of the claims at that
 * bearing, floored just outside the green ring, with the handful of ribbon
 * claims beyond it clipped around -- which is precisely what opens the road
 * passes through the ring.
 *
 * What GATE 8 changes is the RESOLUTION it is measured at. It used to be
 * one number per WEDGE (the sector between two green-attached lanes): four
 * to six steps around the whole village. That was invisible while the
 * fabric was a disc and is glaring beside an irregular body -- the houses
 * wander in and out and the furrows do not follow them, so the eye gets a
 * near-circular ring drawn right beside a blob to compare it against. It is
 * now a `RadialExtent`: the same percentile per EXTENT_BIN_DEG bin,
 * smoothed and interpolated, and the block polygons walk it directly, so
 * the ring's inner edge is a wandering curve rather than an arc.
 *
 * Three rounds of history on the percentile itself, because it has been
 * both extremes: V1 (2026-08-21) replaced a GLOBAL max with a per-wedge
 * one; W3 (2026-08-21) dropped it to 0.35 so strips would nestle in among
 * the fabric; gate 5 (2026-08-22) reversed W3 on the owner's verdict --
 * the ploughed land belongs AROUND the village, not inside it.
 */
function ringInnerEdge(
  green: Green, lots: Lot[], crofts: Croft[], housedLotIds?: ReadonlySet<string>,
): RadialExtent {
  const floor = greenDrawnRadius(green) + RING_SETBACK_M + FIELD_INNER_FLOOR_PAD_M;
  return radialExtent(
    green.centre, builtEdgePoints(lots, crofts, housedLotIds), floor, FIELD_INNER_PERCENTILE,
  );
}

/** The wedge's NOMINAL inner radius -- the mean of the edge across its own
 * span. Only the census arithmetic (how deep the ring must be to feed the
 * village) uses it; every polygon walks the edge itself. */
function wedgeInnerRadius(edge: RadialExtent, wedge: Wedge): number {
  const steps = Math.max(2, Math.ceil(wedge.spanDeg / EXTENT_BIN_DEG));
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    sum += edge.atBearing(wedge.bearingA + (wedge.spanDeg * (i + 0.5)) / steps);
  }
  return sum / steps;
}

/**
 * §7.2 rule 1 ("a maximum radius set by how much land the census needs to
 * eat"): a wedge's ring segment runs from `innerRadius` out to the radius
 * at which the ANGULAR COVERAGE actually painted -- the wedge's span less
 * its green gaps, in radians -- holds `areaM2` of land. Solving
 * `(coverage / 2) * (outer^2 - inner^2) = areaM2` gives the sqrt below.
 *
 * Coverage, not the full span, because the gaps between blocks are open
 * green and grow no crops; sizing against the full span would under-deliver
 * the census by exactly the gap share.
 *
 * The resulting depth is clamped to [FIELD_BLOCK_DEPTH_MIN_M,
 * FIELD_BLOCK_DEPTH_MAX_M]: the floor keeps a block chunky (a thin block is
 * the strip gate 5 rejected), the cap stops a huge census running the ring
 * out to the horizon.
 */
export function blockOuterRadius(
  innerRadius: number, areaM2: number, coverageRad: number,
): number {
  if (!(coverageRad > 0)) return innerRadius + FIELD_BLOCK_DEPTH_MIN_M;
  const rawOuter = Math.sqrt(innerRadius * innerRadius + (2 * Math.max(0, areaM2)) / coverageRad);
  const depth = Math.min(
    FIELD_BLOCK_DEPTH_MAX_M,
    Math.max(FIELD_BLOCK_DEPTH_MIN_M, rawOuter - innerRadius),
  );
  return innerRadius + depth;
}

/**
 * Ground a field block may cover: not water, not inside a lot claim, not
 * inside a croft claim, not within a lane's corridor. The radius and wedge
 * bounds that used to live here are gone -- every point tested is
 * constructed inside the wedge's own ring segment by the caller.
 */
function isClearGround(
  p: Point, lots: Lot[], crofts: Croft[], lanes: Lane[], water: Point[][],
): boolean {
  if (inAnyWater(p, water)) return false;
  for (const lot of lots) {
    if (pointInObb(p, lotObb(lot))) return false;
  }
  for (const croft of crofts) {
    if (pointInPolygon(p, croft.polygon)) return false;
  }
  for (const lane of lanes) {
    if (withinLaneCorridor(p, lane, LANE_SETBACK_M[lane.type] ?? 2)) return false;
  }
  return true;
}

/**
 * `crops[ordinal % crops.length]`, unless this is the wedge's first KEPT
 * block and the roll (only made for the temperate crop table --
 * desert/tropical/pasture tables never swap) hits: then an orchard/vine
 * tile instead, alternating by a per-wedge-run counter shared across the
 * whole village so consecutive swaps read as orchard, vine, orchard, vine
 * rather than always the same tile.
 */
function pickCropGlyph(
  crops: string[], ordinal: number, isFirstBlock: boolean, allowOrchardVine: boolean,
  rng: SeededRandom, toggle: { n: number },
): string {
  if (isFirstBlock && allowOrchardVine && rng.bool(FIELD_ORCHARD_VINE_CHANCE)) {
    const glyph = toggle.n % 2 === 0 ? 'sm-field-orchard' : 'sm-field-vine';
    toggle.n += 1;
    return glyph;
  }
  return crops[ordinal % crops.length];
}

/** An angular window of the ring, degrees, before clipping. */
interface Slot { fromDeg: number; toDeg: number }

/**
 * Gate 5: a wedge's span cut into 1-FIELD_BLOCK_MAX_PER_WEDGE nominal
 * blocks (one per FIELD_BLOCK_SPAN_TARGET_DEG of span) with
 * FIELD_BLOCK_GAP_SHARE of the span left as open green -- distributed as a
 * gap between each pair AND a half-gap at each end, so a block never butts
 * against the wedge's bounding lane. Those bounding lanes are roads passing
 * out through the ring, and the reference map shows them running between
 * blocks, not into the side of one.
 */
function blockSlots(wedge: Wedge): Slot[] {
  const n = Math.max(
    1,
    Math.min(FIELD_BLOCK_MAX_PER_WEDGE, Math.round(wedge.spanDeg / FIELD_BLOCK_SPAN_TARGET_DEG)),
  );
  const gapEach = (wedge.spanDeg * FIELD_BLOCK_GAP_SHARE) / n;
  const blockSpan = (wedge.spanDeg * (1 - FIELD_BLOCK_GAP_SHARE)) / n;
  const slots: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const from = wedge.bearingA + gapEach / 2 + i * (blockSpan + gapEach);
    slots.push({ fromDeg: from, toDeg: from + blockSpan });
  }
  return slots;
}

/**
 * The annular-sector polygon between two bearings and two radii: the outer
 * arc walked forward, the inner arc walked back, closed. Arcs are sampled
 * at FIELD_BLOCK_SLICE_DEG -- the SAME pitch `clipSlotToRuns` tests at, and
 * deliberately so: every vertex this emits is then a bearing that was
 * actually proven clear, at radii including the exact inner and outer arc.
 * A coarser polygon pitch would put corners on untested bearings and let a
 * block's edge graze a lot claim.
 */
function sectorPolygon(
  green: Green, fromDeg: number, toDeg: number,
  innerAt: (deg: number) => number, outerAt: (deg: number) => number,
  skew: number = 0,
): Point[] {
  const span = toDeg - fromDeg;
  const steps = Math.max(2, Math.ceil(span / FIELD_BLOCK_SLICE_DEG));
  const at = (deg: number, r: number): Point => {
    const d = bearingVector(deg);
    return new Point(green.centre.x + d.x * r, green.centre.y + d.y * r);
  };
  // Gate 5.4 SKEW, expressed RADIALLY rather than angularly: the block is
  // deeper at one end than the other, so it is an irregular quad instead of
  // a perfect annular sector -- which is the visual point -- while every
  // vertex stays on a bearing the clip actually tested, at a radius inside
  // [inner, outer], which the clip also tested.
  //
  // The first attempt skewed the SPAN (inner arc subtending a different
  // angle from the outer). That put the shrunk arc's vertices on bearings
  // BETWEEN the tested slices, and the §5.7 net duly caught a vertex inside
  // a lot claim. Bearings are not ours to invent here; radii are.
  const mag = Math.abs(skew) * 0.5;
  const lean = (t: number): number => (skew >= 0 ? t : 1 - t);
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const deg = fromDeg + span * t;
    const depth = outerAt(deg) - innerAt(deg);
    pts.push(at(deg, outerAt(deg) - depth * mag * lean(t)));
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const deg = fromDeg + span * t;
    const depth = outerAt(deg) - innerAt(deg);
    pts.push(at(deg, innerAt(deg) + depth * mag * lean(1 - t)));
  }
  return pts;
}

/** Annular sector area for an angular width in DEGREES. */
function sectorArea(spanDeg: number, inner: number, outer: number): number {
  return ((spanDeg * Math.PI) / 360) * (outer * outer - inner * inner);
}

/**
 * One nominal slot, clipped: the slot is tested in FIELD_BLOCK_SLICE_DEG
 * slices (three bearings x five radii each), and every maximal run of clear
 * slices becomes its own block. That is what opens a road pass -- where an
 * arm's ribbon of lots reaches out through the ring, its slices fail and the
 * block is split either side of the road.
 */
function clipSlotToRuns(
  green: Green, slot: Slot,
  innerAt: (deg: number) => number, outerAt: (deg: number) => number,
  lots: Lot[], crofts: Croft[], lanes: Lane[], water: Point[][],
): Slot[] {
  const span = slot.toDeg - slot.fromDeg;
  const slices = Math.max(1, Math.ceil(span / FIELD_BLOCK_SLICE_DEG));
  const clearAt = (deg: number): boolean => {
    const d = bearingVector(deg);
    const inner = innerAt(deg);
    const depth = outerAt(deg) - inner;
    // GATE 8: the tested radii follow the edge at THIS bearing, because the
    // block's own inner and outer arcs do.
    return [0, 0.25, 0.5, 0.75, 1].map((t) => inner + depth * t).every((r) => isClearGround(
      new Point(green.centre.x + d.x * r, green.centre.y + d.y * r), lots, crofts, lanes, water,
    ));
  };

  const runs: Slot[] = [];
  let runStart = -1;
  for (let i = 0; i < slices; i++) {
    const a = slot.fromDeg + (span * i) / slices;
    const b = slot.fromDeg + (span * (i + 1)) / slices;
    const ok = clearAt(a) && clearAt((a + b) / 2) && clearAt(b);
    if (ok && runStart < 0) runStart = i;
    if (!ok && runStart >= 0) {
      runs.push({ fromDeg: slot.fromDeg + (span * runStart) / slices, toDeg: a });
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    runs.push({ fromDeg: slot.fromDeg + (span * runStart) / slices, toDeg: slot.toDeg });
  }
  return runs;
}

/** One wedge's ring segment: its kept blocks and the radius they reach. */
interface WedgeRing { blocks: FieldBlock[]; outerRadius: number }

function buildWedgeBlocks(
  wedge: Wedge, green: Green, edge: RadialExtent, population: number,
  furrowBearingDeg: number, lots: Lot[], crofts: Croft[], lanes: Lane[], water: Point[][],
  crops: string[], allowOrchardVine: boolean, rng: SeededRandom, toggle: { n: number },
): WedgeRing {
  const innerRadius = wedgeInnerRadius(edge, wedge);
  const slots = blockSlots(wedge);
  const coverageRad = slots.reduce((sum, s) => sum + ((s.toDeg - s.fromDeg) * Math.PI) / 180, 0);
  // This wedge's share of the census demand, by span -- the same
  // distribution across wedges the band used before gate 5.
  const demand = Math.max(0, population) * FIELD_M2_PER_CAPITA * (wedge.spanDeg / 360);
  const outerRadius = blockOuterRadius(innerRadius, demand, coverageRad);
  if (!(outerRadius > innerRadius)) return { blocks: [], outerRadius: innerRadius };

  const blocks: FieldBlock[] = [];
  let ordinal = 0;
  let reach = innerRadius;
  for (const slot of slots) {
    // Gate 5.4: four jitter draws per slot, in slot order, BEFORE the clip
    // -- so the geometry that gets tested against claims is the geometry
    // that gets drawn. Jittering a cleared block afterwards would push it
    // onto ground nothing ever checked.
    const beltOffset = FIELD_BELT_JITTER_MIN_M
      + rng.float() * (FIELD_BELT_JITTER_MAX_M - FIELD_BELT_JITTER_MIN_M);
    const depthMul = 1 + (rng.float() * 2 - 1) * FIELD_DEPTH_JITTER;
    const spanMul = 1 + (rng.float() * 2 - 1) * FIELD_SPAN_JITTER;
    const skew = (rng.float() * 2 - 1) * FIELD_SKEW_JITTER;

    // GATE 8: the block's inner arc IS the measured edge, bearing by
    // bearing, offset by this slot's belt jitter -- so the ring wanders
    // with the body instead of being an arc struck about the green.
    const innerAt = (deg: number): number => edge.atBearing(deg) + beltOffset;
    // The depth clamp still governs: jitter varies the depth WITHIN
    // [FIELD_BLOCK_DEPTH_MIN_M, FIELD_BLOCK_DEPTH_MAX_M], never through it.
    // A block below the floor is the thin strip gate 5 rejected.
    const jDepth = Math.min(
      FIELD_BLOCK_DEPTH_MAX_M,
      Math.max(FIELD_BLOCK_DEPTH_MIN_M, (outerRadius - innerRadius) * depthMul),
    );
    const outerAt = (deg: number): number => innerAt(deg) + jDepth;
    if (!(jDepth > 0)) continue;
    // The span is scaled about the slot's own mid-bearing. The skew needs
    // no allowance here because it only ever shrinks an arc (see
    // `sectorPolygon`), so both arcs stay inside what the clip tested.
    const slotMid = (slot.fromDeg + slot.toDeg) / 2;
    const jSpan = (slot.toDeg - slot.fromDeg) * spanMul;
    const jSlot: Slot = { fromDeg: slotMid - jSpan / 2, toDeg: slotMid + jSpan / 2 };

    for (const run of clipSlotToRuns(green, jSlot, innerAt, outerAt, lots, crofts, lanes, water)) {
      const spanDeg = run.toDeg - run.fromDeg;
      // Area at the run's mid-bearing: the block is an irregular ribbon
      // now, and this is the cull for a block too small to be a field, not
      // the census arithmetic (which is `blockOuterRadius`, above).
      const midDeg = (run.fromDeg + run.toDeg) / 2;
      const area = sectorArea(spanDeg, innerAt(midDeg), outerAt(midDeg));
      // A block this small is the dropped rug, not a field.
      if (area < FIELD_MIN_BLOCK_AREA_M2) continue;
      // Gate 5.4: verify the POLYGON, not just the sample grid.
      //
      // `clipSlotToRuns` proves a set of bearings clear at a fixed slice
      // pitch; `sectorPolygon` emits vertices at its own pitch across the
      // surviving run. Those two pitches only coincide when the run's span
      // is an exact multiple of the slice -- which the span jitter made
      // untrue, so a vertex could land between tested bearings and, in one
      // measured village out of forty, inside a lot claim. Rather than try
      // to keep two samplings in phase, the emitted geometry is checked
      // directly: if any vertex is on claimed ground the block is dropped.
      const polygon = sectorPolygon(green, run.fromDeg, run.toDeg, innerAt, outerAt, skew);
      if (!polygon.every((p) => isClearGround(p, lots, crofts, lanes, water))) continue;
      const glyph = pickCropGlyph(crops, blocks.length, blocks.length === 0, allowOrchardVine, rng, toggle);
      blocks.push({
        id: `field:${wedge.id}:S${ordinal}`,
        wedgeId: wedge.id,
        glyph,
        polygon,
        furrowBearingDeg,
        areaM2: area,
      });
      ordinal += 1;
      for (const p of polygon) reach = Math.max(reach, dist(green.centre, p));
    }
  }
  return { blocks, outerRadius: Math.max(outerRadius, reach) };
}

/**
 * GATE 8: every point that marks the built-up edge -- the corners of each
 * HOUSED lot claim and the vertices of each croft. `computeFabricRadius`
 * is the max of their distances; `radialExtent` bins them by bearing, and
 * that is what the vegetation band follows now that the body is irregular.
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

export interface FieldsResult {
  blocks: FieldBlock[];
  /** Gate 5: EMPTY. The ring's blocks carry no outline -- no hedge, wall,
   * fence or ditch anywhere on a field. Kept on the result (and threaded to
   * `VillageModel.fieldEdges`, and painted by the renderer) so the edge
   * machinery stays wired up for a future design that wants it back; the
   * `edges` module and `stampEdge` are likewise kept, unused. */
  edges: EdgeStamp[];
  /** The OUTERMOST radius any kept block reaches -- the measured fabric
   * radius when no block was kept at all. Vegetation's `innerEdge` and the
   * stone circle's ring use this, not a prediction. */
  outerRadius: number;
}

/**
 * §7.2: the whole field system for one village -- since gate 5, a ring of
 * chunky blocks around the settlement. Draws (in order, after any
 * caller-side draws): one jitter float per wedge (wedge-id-sorted order),
 * plus -- only when that wedge keeps a first block AND its biome resolves
 * to the temperate crop table -- one orchard/vine bool.
 *
 * Never throws: a village with fewer than 2 green-attached lanes gets one
 * full-circle wedge (§8.5); the depth clamp guarantees a positive band. An
 * empty result only happens when every slice of every slot is claimed
 * (water/lanes/claims wall the ring off) or every block was culled below
 * FIELD_MIN_BLOCK_AREA_M2.
 *
 * Two orderings, deliberately different, and neither may be collapsed into
 * the other:
 *  - RNG order is wedge-id-sorted, so the draw sequence never depends on
 *    geometry (§8.1). Every wedge spends its jitter float up front, before
 *    any geometry gate, so a wedge that produces nothing still spends it.
 *  - Furrow alternation is walked in the BEARING-sorted order `buildWedges`
 *    produces, i.e. in SPATIAL adjacency (fix wave, I2).
 *
 * §7.2's alternation is enforced as a constraint, not assumed from a fixed
 * +90 on alternate wedges. Keyed to the lexical id rank, as it once was, it
 * was only alternating on paper: 28% of spatially adjacent bundles came out
 * within 15 degrees of parallel. But a fixed offset cannot deliver it
 * either -- an odd wedge count leaves one same-parity seam at the wrap by
 * construction, and two wedges whose bisectors already differ by ~90 land
 * PARALLEL once one of them is turned 90. So each wedge, in bearing order,
 * takes the first of +0/+45/+90/+135 on its parity base that clears
 * FIELD_FURROW_MIN_SEPARATION_DEG of parallel against both already-fixed
 * neighbours (the previous wedge, and for the last wedge also the first).
 * The jitter is applied inside each candidate, so this spends no rng.
 *
 * ONE furrow bearing per wedge, shared by that wedge's blocks: blocks in a
 * wedge are one estate separated by green gaps, and the seam the
 * alternation exists to break is the one between NEIGHBOURING estates.
 */
export function buildFields(
  site: Site, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], rng: SeededRandom,
  housedLotIds?: ReadonlySet<string>,
): FieldsResult {
  const fabricRadius = computeFabricRadius(green, lots, crofts, housedLotIds);

  const byBearing = buildWedges(green, lanes);
  const wedges = byBearing.slice().sort((a, b) => a.id.localeCompare(b.id));

  // Phase 1 -- every rng draw this stage makes before geometry: one jitter
  // float per wedge, wedge-id-sorted.
  const jitterById = new Map<string, number>();
  for (const wedge of wedges) {
    jitterById.set(wedge.id, rng.float() * FIELD_JITTER_RANGE_DEG - FIELD_JITTER_RANGE_DEG / 2);
  }

  // Phase 2 -- furrow bearings, walked in bearing order so "the neighbour"
  // means the spatial neighbour. No rng.
  const bearingByWedge = new Map<string, number>();
  const clearsNeighbour = (candidate: number, neighbour: number | undefined): boolean => {
    if (neighbour === undefined) return true;
    const gap = angularGap(candidate, neighbour) % 180;
    return Math.min(gap, 180 - gap) > FIELD_FURROW_MIN_SEPARATION_DEG;
  };
  byBearing.forEach((wedge, rank) => {
    const jitter = jitterById.get(wedge.id) ?? 0;
    const base = wedge.bisectorDeg + (rank % 2 === 0 ? 0 : 90);
    const prev = rank > 0 ? bearingByWedge.get(byBearing[rank - 1].id) : undefined;
    // The last wedge closes the ring against the first; with 2 wedges the
    // pair is already covered by `prev`.
    const wrap = byBearing.length > 2 && rank === byBearing.length - 1
      ? bearingByWedge.get(byBearing[0].id)
      : undefined;
    const candidates = [0, 45, 90, 135].map((extra) => wrapDeg(base + extra + jitter));
    const chosen = candidates.find(
      (c) => clearsNeighbour(c, prev) && clearsNeighbour(c, wrap),
    ) ?? candidates[0];
    bearingByWedge.set(wedge.id, chosen);
  });

  const crops = FIELD_CROPS[site.biome] ?? FIELD_CROPS.temperate;
  const allowOrchardVine = crops === FIELD_CROPS.temperate;
  const toggle = { n: 0 };

  // Phase 3 -- geometry, wedge-id-sorted so the orchard/vine draws stay in
  // a fixed order too.
  const blocks: FieldBlock[] = [];
  let outerRadius = fabricRadius;
  const edge = ringInnerEdge(green, lots, crofts, housedLotIds);
  for (const wedge of wedges) {
    const ring = buildWedgeBlocks(
      wedge, green, edge, site.population, bearingByWedge.get(wedge.id) ?? 0,
      lots, crofts, lanes, site.water, crops, allowOrchardVine, rng, toggle,
    );
    if (ring.blocks.length === 0) continue;
    blocks.push(...ring.blocks);
    outerRadius = Math.max(outerRadius, ring.outerRadius);
  }
  return { blocks, edges: [], outerRadius };
}
