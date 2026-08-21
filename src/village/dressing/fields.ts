import { Point } from '../../types/point.js';
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { SeededRandom } from '../../utils/random.js';
import {
  angularGap, bearingOf, bearingVector, dist, greenDrawnRadius, inAnyWater,
  withinLaneCorridor, wrapDeg,
} from '../geometry.js';
import { lotObb, pointInObb, type Obb } from '../parcels/overlap.js';
import { stampEdge } from './edges.js';
import {
  FIELD_BAND_DEPTH_MAX_M, FIELD_BAND_DEPTH_MIN_M, FIELD_CROPS, FIELD_JITTER_RANGE_DEG,
  FIELD_FURROW_MIN_SEPARATION_DEG, FIELD_M2_PER_CAPITA, FIELD_MIN_BUNDLE_AREA_M2,
  FIELD_ORCHARD_VINE_CHANCE, FIELD_SAMPLE_STEP_M,
  FIELD_WEDGE_CLAIM_MARGIN_DEG, FURROW_MIN_LENGTH_M, FURROW_WIDTH_M, LANE_SETBACK_M,
} from '../constants.js';
import type {
  Croft, EdgeStamp, EdgeStyle, FieldStrip, Green, Lane, Lot, Site,
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
 * "The croft line": how far the built-up edge already reaches IN THIS
 * DIRECTION, so fields never start closer in than that but also never start
 * further out than the fabric they are supposed to hug.
 *
 * The max, over every lot claim and croft the wedge contains, of its
 * farthest corner from the green centre; floored at the green's drawn
 * radius. A claim belongs to a wedge when the bearing of its own centre
 * (the claim OBB's centre, a croft's polygon centroid) from the green falls
 * inside the wedge's span widened by FIELD_WEDGE_CLAIM_MARGIN_DEG.
 *
 * Fix wave (2026-08-21, V1): this used to be a GLOBAL max over the whole
 * village, which pushed every wedge's band out past the single deepest lane
 * in the settlement -- fields then read as a detached annulus floating
 * clear of the fabric, most obviously over empty quadrants, where the band
 * started a hundred metres from anything built. Per-wedge, an empty quadrant
 * starts its band just outside the green ring, where it belongs.
 *
 * Called with no `wedge` it still returns the global measured fabric radius,
 * which is what the POI stage keys the stone circle's ring off (C1).
 */
export function computeInnerRadius(
  green: Green, lots: Lot[], crofts: Croft[], wedge?: Wedge,
): number {
  let maxR = greenDrawnRadius(green);
  for (const lot of lots) {
    const obb = lotObb(lot);
    if (wedge && !bearingInWedge(obb.center, green, wedge)) continue;
    for (const c of obbCorners(obb)) {
      maxR = Math.max(maxR, dist(green.centre, c));
    }
  }
  for (const croft of crofts) {
    if (croft.polygon.length === 0) continue;
    if (wedge && !bearingInWedge(centroid(croft.polygon), green, wedge)) continue;
    for (const p of croft.polygon) {
      maxR = Math.max(maxR, dist(green.centre, p));
    }
  }
  return maxR;
}

/**
 * §7.2 rule 1: the field band's outer radius, as the annulus (centred on
 * the green, inner radius `innerRadius`) whose AREA equals the census's
 * field demand (`population * FIELD_M2_PER_CAPITA`). Solving
 * pi*(outer^2 - inner^2) = demand for outer gives the sqrt below. The
 * resulting depth (outer - inner) is clamped to [FIELD_BAND_DEPTH_MIN_M,
 * FIELD_BAND_DEPTH_MAX_M] so a tiny census still gets room for a furrow
 * and a huge one doesn't run fields out to the horizon. Exported so
 * `dressing/index.ts` can hand vegetation's `innerEdge` the field system's
 * ACTUAL outer radius (not a stale prediction) once fields exist.
 *
 * Applied PER WEDGE since the V1 fix, with that wedge's own inner radius.
 * That still distributes the same total demanded area: asking a wedge's
 * annular SECTOR to hold `demand x span/2pi` gives
 * `(span/2pi) x pi x (outer^2 - inner^2) = demand x span/2pi` -- the span
 * cancels, leaving the very same equation as the full annulus. One formula
 * serves both, and no wedge is favoured for being wide.
 */
export function fieldOuterRadius(innerRadius: number, population: number): number {
  const demand = Math.max(0, population) * FIELD_M2_PER_CAPITA;
  const rawOuter = Math.sqrt(innerRadius * innerRadius + demand / Math.PI);
  const depth = Math.min(FIELD_BAND_DEPTH_MAX_M, Math.max(FIELD_BAND_DEPTH_MIN_M, rawOuter - innerRadius));
  return innerRadius + depth;
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
    if (withinLaneCorridor(p, lane, LANE_SETBACK_M[lane.type] ?? 2)) return false;
  }
  return true;
}

/**
 * `crops[ordinal % crops.length]`, unless this is the wedge's first KEPT
 * strip and the roll (only made for the temperate crop table --
 * desert/tropical/pasture tables never swap) hits: then an orchard/vine
 * tile instead, alternating by a per-wedge-run counter shared across the
 * whole village so consecutive swaps read as orchard, vine, orchard, vine
 * rather than always the same tile.
 *
 * M1: "first" here means first in the strip walk, which runs ACROSS the
 * furrow direction -- it is a lateral edge of the block, NOT the ring
 * nearest the settlement, as this used to claim ("isFirstRing"). One strip
 * per wedge carrying the swap is the point; no proximity is asserted,
 * because none is measured. Gating the swap on genuine proximity to the
 * fabric would need a second pass over the kept strips and is a design
 * question for a render gate, not a rename.
 */
function pickCropGlyph(
  crops: string[], ordinal: number, isFirstStrip: boolean, allowOrchardVine: boolean,
  rng: SeededRandom, toggle: { n: number },
): string {
  if (isFirstStrip && allowOrchardVine && rng.bool(FIELD_ORCHARD_VINE_CHANCE)) {
    const glyph = toggle.n % 2 === 0 ? 'sm-field-orchard' : 'sm-field-vine';
    toggle.n += 1;
    return glyph;
  }
  return crops[ordinal % crops.length];
}

/**
 * §7.2/V2: one wedge's whole field BLOCK -- the strips plus, once, the
 * block's own perimeter as edge stamps. Per-strip outlines are what turned
 * every render into caterpillar chains of hedge glyphs: 12 m strips fully
 * outlined leave nothing but boundary. Strip separation is carried by the
 * alternating crop tiles instead, and only the bundle's outside edge is
 * stamped.
 */
export interface FieldBundle {
  wedgeId: string;
  strips: FieldStrip[];
  /** Total area of `strips`, m^2 -- V4's cull threshold input. */
  areaM2: number;
  /** The block's perimeter stamps (one closed ring per contiguous run of
   * strips; a run break means water/a lane split the block in two). */
  boundary: EdgeStamp[];
}

/** Local (u, v) extents of one kept strip, in the wedge's furrow frame. */
interface StripBox { band: number; uStart: number; uEnd: number; vLo: number; vHi: number }

/**
 * The rectilinear outline of one contiguous run of strips: up the far (uEnd)
 * side band by band, then back down the near (uStart) side, closing on the
 * first point. Runs are split on a gap in band index so a block broken in
 * two by water or a lane never gets an outline spanning the hole.
 */
function bundleOutlines(boxes: StripBox[], toXY: (u: number, v: number) => Point): Point[][] {
  const rings: Point[][] = [];
  let run: StripBox[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const pts: Point[] = [];
    for (const b of run) pts.push(toXY(b.uEnd, b.vLo), toXY(b.uEnd, b.vHi));
    for (let i = run.length - 1; i >= 0; i--) {
      pts.push(toXY(run[i].uStart, run[i].vHi), toXY(run[i].uStart, run[i].vLo));
    }
    pts.push(pts[0]);
    rings.push(pts);
    run = [];
  };
  for (const box of boxes) {
    if (run.length > 0 && box.band !== run[run.length - 1].band + 1) flush();
    run.push(box);
  }
  flush();
  return rings;
}

function buildWedgeStrips(
  wedge: Wedge, green: Green, innerRadius: number, fieldRadius: number,
  furrowBearingDeg: number, lots: Lot[], crofts: Croft[], lanes: Lane[], water: Point[][],
  style: EdgeStyle, crops: string[], allowOrchardVine: boolean,
  rng: SeededRandom, toggle: { n: number },
): FieldBundle {
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
  const empty: FieldBundle = {
    wedgeId: wedge.id, strips: [], areaM2: 0, boundary: [],
  };
  if (!(uMax > uMin) || !(vMax > vMin)) return empty;

  const toXY = (u: number, v: number): Point => new Point(
    green.centre.x + u * furrowDir.x + v * perpDir.x,
    green.centre.y + u * furrowDir.y + v * perpDir.y,
  );

  const strips: FieldStrip[] = [];
  const boxes: StripBox[] = [];
  let areaM2 = 0;
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
        const isFirstStrip = createdIndex === 0;
        const glyph = pickCropGlyph(crops, createdIndex, isFirstStrip, allowOrchardVine, rng, toggle);
        const polygon = [toXY(uStart, vLo), toXY(uEnd, vLo), toXY(uEnd, vHi), toXY(uStart, vHi)];
        const id = `field:${wedge.id}:S${ordinal}`;
        strips.push({
          id, wedgeId: wedge.id, glyph, polygon, furrowBearingDeg,
        });
        boxes.push({ band: ordinal, uStart, uEnd, vLo, vHi });
        areaM2 += (uEnd - uStart) * (vHi - vLo);
        createdIndex += 1;
      }
    }
    ordinal += 1;
  }

  const boundary: EdgeStamp[] = [];
  bundleOutlines(boxes, toXY).forEach((ring, i) => {
    boundary.push(...stampEdge(`bundle:${wedge.id}:R${i}`, ring, style, lanes));
  });
  return {
    wedgeId: wedge.id, strips, areaM2, boundary,
  };
}

export interface FieldsResult {
  strips: FieldStrip[];
  /** The block perimeter stamps for every surviving bundle (V2): the field
   * system's boundary art, no longer carried per strip. */
  edges: EdgeStamp[];
  /** The OUTERMOST of the per-wedge band radii (from the green centre) --
   * the measured fabric radius when no strip was kept at all. Vegetation's
   * `innerEdge` and the stone circle's ring use this, not a prediction. */
  outerRadius: number;
}

/**
 * §7.2: the whole field system for one village. Draws (in order, after any
 * caller-side draws): one jitter float per wedge (wedge-id-sorted order),
 * plus -- only when that wedge produces a kept first strip AND its biome
 * resolves to the temperate crop table -- one orchard/vine bool.
 * Never throws: a village with fewer than 2 green-attached lanes gets one
 * full-circle wedge (§8.5); a village whose census demand rounds down to
 * less than the minimum band depth still gets the FIELD_BAND_DEPTH_MIN_M floor (see
 * `fieldOuterRadius`), so an empty result only happens when every sampled
 * point in that band is genuinely claimed (water/lanes/claims wall it off)
 * or every bundle was culled as a fragment (V4).
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
 * +90 on alternate wedges. Keyed to the lexical id rank, as it was, it was
 * only alternating on paper: 28% of spatially adjacent bundles came out
 * within 15 degrees of parallel. But a fixed offset cannot deliver it
 * either -- an odd wedge count leaves one same-parity seam at the wrap by
 * construction, and two wedges whose bisectors already differ by ~90 land
 * PARALLEL once one of them is turned 90. So each wedge, in bearing order,
 * takes the first of +0/+45/+90/+135 on its parity base that clears
 * FIELD_FURROW_MIN_SEPARATION_DEG of parallel against both already-fixed
 * neighbours (the previous wedge, and for the last wedge also the first).
 * The jitter is applied inside each candidate, so this spends no rng.
 */
export function buildFields(
  site: Site, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[],
  style: EdgeStyle, rng: SeededRandom,
): FieldsResult {
  const fabricRadius = computeInnerRadius(green, lots, crofts);

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

  const strips: FieldStrip[] = [];
  const edges: EdgeStamp[] = [];
  let outerRadius = fabricRadius;
  for (const wedge of wedges) {
    // V1: this wedge's OWN inner radius -- the fabric it must hug, not the
    // village's deepest lane. An empty quadrant starts at the green ring.
    const innerRadius = computeInnerRadius(green, lots, crofts, wedge);
    const fieldRadius = fieldOuterRadius(innerRadius, site.population);
    if (!(fieldRadius > innerRadius)) continue;

    const bundle = buildWedgeStrips(
      wedge, green, innerRadius, fieldRadius, bearingByWedge.get(wedge.id) ?? 0,
      lots, crofts, lanes, site.water, style, crops, allowOrchardVine, rng, toggle,
    );
    // V4: a bundle this small reads as a dropped rug, not a field system.
    if (bundle.strips.length === 0 || bundle.areaM2 < FIELD_MIN_BUNDLE_AREA_M2) continue;
    strips.push(...bundle.strips);
    edges.push(...bundle.boundary);
    outerRadius = Math.max(outerRadius, fieldRadius);
  }
  return { strips, edges, outerRadius };
}
