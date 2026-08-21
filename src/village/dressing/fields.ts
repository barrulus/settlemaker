import { Point } from '../../types/point.js';
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { SeededRandom } from '../../utils/random.js';
import {
  bearingOf, bearingVector, closestPointOnSegment, dist, inAnyWater, wrapDeg,
} from '../geometry.js';
import { lotObb, type Obb } from '../parcels/overlap.js';
import { stampEdge } from './edges.js';
import {
  FIELD_CROPS, FIELD_JITTER_RANGE_DEG, FIELD_ORCHARD_VINE_CHANCE, FIELD_RADIUS_FACTOR,
  FIELD_SAMPLE_STEP_M, FURROW_MIN_LENGTH_M, FURROW_WIDTH_M, GREEN_JOIN_RATIO,
  LANE_SETBACK_M, RING_SETBACK_M,
} from '../constants.js';
import type {
  Croft, EdgeStyle, FieldStrip, Green, Lane, Lot, Site,
} from '../types.js';

/**
 * §7.2: the census-eating field system, laid out beyond the built-up edge
 * (crofts/lot claims) as wedges (angular sectors between adjacent
 * green-attached lanes), furlong strips within each wedge, and a crop per
 * strip. Everything here is geometric approximation by design (the brief:
 * "modest geometric approximation is fine") -- strips are RENDERED as
 * pattern-filled polygons, not simulated farmland, so a sampled clip that
 * keeps the largest surviving fragment reads correctly at village scale.
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

/**
 * "The croft line": how far the built-up edge already reaches, so fields
 * never start closer in than that. Simpler alternative chosen over a
 * per-wedge inner radius (the brief sanctions this when per-wedge proves
 * fiddly): the GLOBAL max, over every lot claim and croft in the village,
 * of its farthest corner from the green centre. A per-wedge radius would
 * need the same sampling machinery `isFieldPoint` already does per strip;
 * reusing a single conservative global radius is cheaper and never lets a
 * field creep inside another wedge's built edge either.
 */
function computeInnerRadius(green: Green, lots: Lot[], crofts: Croft[]): number {
  let maxR = (green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
  for (const lot of lots) {
    for (const c of obbCorners(lotObb(lot))) {
      maxR = Math.max(maxR, dist(green.centre, c));
    }
  }
  for (const croft of crofts) {
    for (const p of croft.polygon) {
      maxR = Math.max(maxR, dist(green.centre, p));
    }
  }
  return maxR;
}

function pointInObb(p: Point, obb: Obb): boolean {
  const d = new Point(p.x - obb.center.x, p.y - obb.center.y);
  const alongT = Math.abs(d.x * obb.tangent.x + d.y * obb.tangent.y);
  const alongN = Math.abs(d.x * obb.normal.x + d.y * obb.normal.y);
  return alongT <= obb.halfW && alongN <= obb.halfD;
}

function withinLaneCorridor(p: Point, lane: Lane): boolean {
  if (lane.points.length < 2) return false;
  const clearance = lane.widthM / 2 + (LANE_SETBACK_M[lane.type] ?? 2);
  let best = Infinity;
  for (let i = 1; i < lane.points.length; i++) {
    const q = closestPointOnSegment(p, lane.points[i - 1], lane.points[i]);
    best = Math.min(best, dist(p, q));
    if (best <= clearance) return true;
  }
  return false;
}

/**
 * Cheap checks first (radius, then angle) so the sector's bounding box --
 * which can be much larger than the actual wedge for a wide span -- rejects
 * most sampled points before the expensive per-lot/croft/lane loops run.
 */
function isFieldPoint(
  p: Point, green: Green, wedge: Wedge, innerRadius: number, fieldRadius: number,
  lots: Lot[], crofts: Croft[], lanes: Lane[], water: Point[][],
): boolean {
  const r = dist(p, green.centre);
  if (r < innerRadius || r > fieldRadius) return false;
  if (wedge.spanDeg < 359.999) {
    const rel = wrapDeg(bearingOf(green.centre, p) - wedge.bearingA);
    if (rel > wedge.spanDeg) return false;
  }
  if (inAnyWater(p, water)) return false;
  for (const lot of lots) {
    if (pointInObb(p, lotObb(lot))) return false;
  }
  for (const croft of crofts) {
    if (pointInPolygon(p, croft.polygon)) return false;
  }
  for (const lane of lanes) {
    if (withinLaneCorridor(p, lane)) return false;
  }
  return true;
}

/** `crops[ordinal % crops.length]`, unless this is the wedge's first
 * (innermost) strip ring and the roll (only made for the temperate crop
 * table -- desert/tropical/pasture tables never swap) hits: then an
 * orchard/vine tile instead, alternating by a per-wedge-run counter shared
 * across the whole village so consecutive swaps read as orchard, vine,
 * orchard, vine rather than always the same tile. */
function pickCropGlyph(
  crops: string[], ordinal: number, isFirstRing: boolean, allowOrchardVine: boolean,
  rng: SeededRandom, toggle: { n: number },
): string {
  if (isFirstRing && allowOrchardVine && rng.bool(FIELD_ORCHARD_VINE_CHANCE)) {
    const glyph = toggle.n % 2 === 0 ? 'sm-field-orchard' : 'sm-field-vine';
    toggle.n += 1;
    return glyph;
  }
  return crops[ordinal % crops.length];
}

function buildWedgeStrips(
  wedge: Wedge, green: Green, innerRadius: number, fieldRadius: number,
  furrowBearingDeg: number, lots: Lot[], crofts: Croft[], lanes: Lane[], water: Point[][],
  style: EdgeStyle, crops: string[], allowOrchardVine: boolean,
  rng: SeededRandom, toggle: { n: number },
): FieldStrip[] {
  const furrowDir = bearingVector(furrowBearingDeg);
  const perpDir = bearingVector(furrowBearingDeg + 90);

  // Bound the wedge in furrow-aligned (u, v) local coordinates by sampling
  // its boundary arcs (inner + outer radius, across the full span).
  const arcSteps = Math.max(4, Math.ceil(wedge.spanDeg / 5));
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i <= arcSteps; i++) {
    const bearing = wrapDeg(wedge.bearingA + (wedge.spanDeg * i) / arcSteps);
    const dir = bearingVector(bearing);
    for (const radius of [innerRadius, fieldRadius]) {
      const dx = dir.x * radius;
      const dy = dir.y * radius;
      const u = dx * furrowDir.x + dy * furrowDir.y;
      const v = dx * perpDir.x + dy * perpDir.y;
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }
  }
  if (!(uMax > uMin) || !(vMax > vMin)) return [];

  const toXY = (u: number, v: number): Point => new Point(
    green.centre.x + u * furrowDir.x + v * perpDir.x,
    green.centre.y + u * furrowDir.y + v * perpDir.y,
  );

  const strips: FieldStrip[] = [];
  const uSteps = Math.max(1, Math.ceil((uMax - uMin) / FIELD_SAMPLE_STEP_M));
  let ordinal = 0;
  let createdIndex = 0;
  for (let vLo = vMin; vLo < vMax; vLo += FURROW_WIDTH_M) {
    const vHi = Math.min(vLo + FURROW_WIDTH_M, vMax);
    const vSamples = [vLo, vLo + (vHi - vLo) * 0.25, (vLo + vHi) / 2, vLo + (vHi - vLo) * 0.75, vHi];
    const validAt = (u: number): boolean => vSamples.every((v) => isFieldPoint(
      toXY(u, v), green, wedge, innerRadius, fieldRadius, lots, crofts, lanes, water,
    ));

    // Largest contiguous run of valid u samples -- "keep the largest
    // fragment per strip" when water/lanes/claims split the band.
    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    let prevValid = false;
    for (let i = 0; i <= uSteps; i++) {
      const u = uMin + ((uMax - uMin) * i) / uSteps;
      const ok = validAt(u);
      if (ok && !prevValid) curStart = i;
      if (!ok && prevValid && i - curStart > bestLen) { bestLen = i - curStart; bestStart = curStart; }
      prevValid = ok;
    }
    if (prevValid && uSteps + 1 - curStart > bestLen) { bestLen = uSteps + 1 - curStart; bestStart = curStart; }

    if (bestStart >= 0) {
      const uStart = uMin + ((uMax - uMin) * bestStart) / uSteps;
      const uEnd = uMin + ((uMax - uMin) * (bestStart + bestLen - 1)) / uSteps;
      if (uEnd - uStart >= FURROW_MIN_LENGTH_M) {
        const isFirstRing = createdIndex === 0;
        const glyph = pickCropGlyph(crops, createdIndex, isFirstRing, allowOrchardVine, rng, toggle);
        const polygon = [toXY(uStart, vLo), toXY(uEnd, vLo), toXY(uEnd, vHi), toXY(uStart, vHi)];
        const id = `field:${wedge.id}:S${ordinal}`;
        const boundary = stampEdge(id, [...polygon, polygon[0]], style, lanes);
        strips.push({
          id, wedgeId: wedge.id, glyph, polygon, furrowBearingDeg, boundary,
        });
        createdIndex += 1;
      }
    }
    ordinal += 1;
  }
  return strips;
}

/**
 * §7.2: the whole field system for one village. Draws (in order, after any
 * caller-side draws): one jitter float per wedge (wedge-id-sorted order),
 * plus -- only when that wedge produces a kept first-ring strip AND its
 * biome resolves to the temperate crop table -- one orchard/vine bool.
 * Never throws: a village with fewer than 2 green-attached lanes gets one
 * full-circle wedge (§8.5), and a village whose built-up edge already
 * reaches FIELD_RADIUS gets no fields at all.
 */
export function buildFields(
  site: Site, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[],
  builtRadiusM: number, style: EdgeStyle, rng: SeededRandom,
): FieldStrip[] {
  const innerRadius = computeInnerRadius(green, lots, crofts);
  const fieldRadius = builtRadiusM * FIELD_RADIUS_FACTOR;
  if (!(fieldRadius > innerRadius)) return [];

  const wedges = buildWedges(green, lanes)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  const crops = FIELD_CROPS[site.biome] ?? FIELD_CROPS.temperate;
  const allowOrchardVine = crops === FIELD_CROPS.temperate;
  const toggle = { n: 0 };

  const strips: FieldStrip[] = [];
  wedges.forEach((wedge, idx) => {
    const jitter = rng.float() * FIELD_JITTER_RANGE_DEG - FIELD_JITTER_RANGE_DEG / 2;
    const base = idx % 2 === 0 ? wedge.bisectorDeg : wedge.bisectorDeg + 90;
    const furrowBearingDeg = wrapDeg(base + jitter);
    strips.push(...buildWedgeStrips(
      wedge, green, innerRadius, fieldRadius, furrowBearingDeg,
      lots, crofts, lanes, site.water, style, crops, allowOrchardVine, rng, toggle,
    ));
  });
  return strips;
}
