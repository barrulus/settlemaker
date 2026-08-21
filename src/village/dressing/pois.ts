import { Point } from '../../types/point.js';
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { SeededRandom } from '../../utils/random.js';
import { renderBearingFor } from '../dwellings.js';
import { resolveGlyphFor } from '../deck.js';
import { hasGlyph, nominalFootprint } from '../glyphs.js';
import { lotObb, type Obb } from '../parcels/overlap.js';
import {
  arcLengths, bearingOf, bearingVector, closestPointOnSegment, dist, greenDrawnRadius,
  inAnyWater, sampleAt, unit,
} from '../geometry.js';
import {
  BOATHOUSE_SLIDE_RANGE_M, BOATHOUSE_SLIDE_STEP_M,
  STONE_CIRCLE_BEARING_TRIES, STONE_CIRCLE_CHANCE,
  STONE_CIRCLE_FOOTPRINT_RADIUS_M, STONE_CIRCLE_RADIUS_FACTOR, STONE_CIRCLE_VEG_CLEAR_M,
  WELL_LANE_CLEAR_M, WELL_MIN_POP, WELL_NUDGE_CAP_RATIO, WELL_NUDGE_STEP_M,
} from '../constants.js';
import type {
  Croft, FieldStrip, Green, Lane, Lot, Poi, Site, Vegetation,
} from '../types.js';

/**
 * §7.4/§8.5: capped, rule-gated POI placements -- well, stone circle,
 * boathouse -- each placed at most once per village. Called LAST among
 * dressing stages (after edgeStyle/crofts/fields/vegetation), so every rng
 * draw here comes after all of theirs -- never reordered or interleaved.
 *
 * Draw order, fixed:
 *   1. well -- draws NO rng (a deterministic geometric nudge, §8.5).
 *   2. stone circle -- ONE rng.bool(STONE_CIRCLE_CHANCE) draw ALWAYS, so
 *      whether it lands never shifts what comes after; if true, up to
 *      STONE_CIRCLE_BEARING_TRIES rng.int(0,360) draws (only in the true
 *      branch -- gated deterministically by the bool already drawn).
 *   3. boathouse -- draws NO rng (a deterministic nearest-first shore slide).
 */

function distanceToLane(p: Point, lane: Lane): number {
  let best = Infinity;
  for (let i = 1; i < lane.points.length; i++) {
    best = Math.min(best, dist(p, closestPointOnSegment(p, lane.points[i - 1], lane.points[i])));
  }
  return best;
}

function nearestSegmentOnLane(p: Point, lane: Lane): [Point, Point] | null {
  let best = Infinity;
  let seg: [Point, Point] | null = null;
  for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1];
    const b = lane.points[i];
    const d = dist(p, closestPointOnSegment(p, a, b));
    if (d < best) { best = d; seg = [a, b]; }
  }
  return seg;
}

/**
 * §8.5: well -- every village at WELL_MIN_POP or above gets one, at the
 * green's centre, the one place a structure may sit on `parcel` ground.
 * Nudged off any under-green lane centreline: if the centre sits within the
 * lane's own half-width plus the well footprint's half extent plus
 * WELL_LANE_CLEAR_M of ANY lane, push perpendicular to the WORST-offending
 * lane's nearest segment until clear of EVERY lane, capped at the green's
 * drawn radius x WELL_NUDGE_CAP_RATIO. Both perpendicular directions are
 * tried (the segment's +90/-90 rotation, a fixed order so this stays
 * deterministic); if neither clears within the cap, the well stays at
 * centre anyway (fail soft, §8.5 -- it reads fine painted over the turf).
 * No rng: this is pure geometry, the well never varies between seeds.
 */
export function placeWell(green: Green, lanes: Lane[], biome: string): Poi | null {
  const glyph = resolveGlyphFor(biome, 'sm-well');
  if (!hasGlyph(glyph)) return null;
  const [w, d] = nominalFootprint(glyph);
  const maxDim = Math.max(w, d);
  const clearanceFor = (lane: Lane): number => lane.widthM / 2 + maxDim / 2 + WELL_LANE_CLEAR_M;

  const offending = lanes
    .map((lane) => ({ lane, distance: distanceToLane(green.centre, lane), clearance: clearanceFor(lane) }))
    .filter((e) => e.distance < e.clearance)
    .sort((a, b) => a.distance - b.distance);

  if (offending.length === 0) {
    return { id: 'poi:well', kind: 'well', glyph, position: green.centre, bearingDeg: 0 };
  }

  const seg = nearestSegmentOnLane(green.centre, offending[0].lane);
  if (!seg) {
    return { id: 'poi:well', kind: 'well', glyph, position: green.centre, bearingDeg: 0 };
  }
  const [a, b] = seg;
  const dir = unit(b.x - a.x, b.y - a.y);
  const perp = new Point(-dir.y, dir.x);
  const maxPush = greenDrawnRadius(green) * WELL_NUDGE_CAP_RATIO;

  const clearsAllLanes = (p: Point): boolean => lanes.every((lane) => distanceToLane(p, lane) >= clearanceFor(lane));

  const tryPush = (sign: 1 | -1): Point | null => {
    for (let s = WELL_NUDGE_STEP_M; s <= maxPush + 1e-9; s += WELL_NUDGE_STEP_M) {
      const candidate = new Point(
        green.centre.x + perp.x * sign * s,
        green.centre.y + perp.y * sign * s,
      );
      if (clearsAllLanes(candidate)) return candidate;
    }
    return null;
  };

  const position = tryPush(1) ?? tryPush(-1) ?? green.centre;
  return { id: 'poi:well', kind: 'well', glyph, position, bearingDeg: 0 };
}

/** Closest point ON `obb`'s boundary/interior to `p` (clamped-projection). */
function closestPointOnObb(p: Point, obb: Obb): Point {
  const d = new Point(p.x - obb.center.x, p.y - obb.center.y);
  const alongT = Math.max(-obb.halfW, Math.min(obb.halfW, d.x * obb.tangent.x + d.y * obb.tangent.y));
  const alongN = Math.max(-obb.halfD, Math.min(obb.halfD, d.x * obb.normal.x + d.y * obb.normal.y));
  return new Point(
    obb.center.x + obb.tangent.x * alongT + obb.normal.x * alongN,
    obb.center.y + obb.tangent.y * alongT + obb.normal.y * alongN,
  );
}

/** True when the disc of `radius` around `centre` intersects the (closed)
 * polygon -- containment OR an edge closer than `radius`. */
function circleIntersectsPolygon(centre: Point, radius: number, polygon: Point[]): boolean {
  if (polygon.length < 2) return false;
  if (pointInPolygon(centre, polygon)) return true;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (dist(centre, closestPointOnSegment(centre, a, b)) < radius) return true;
  }
  return false;
}

function circleClearOfClaims(
  centre: Point, radius: number, lanes: Lane[], lots: Lot[], crofts: Croft[], fields: FieldStrip[],
): boolean {
  for (const lane of lanes) {
    if (distanceToLane(centre, lane) < radius + lane.widthM / 2) return false;
  }
  for (const lot of lots) {
    if (dist(centre, closestPointOnObb(centre, lotObb(lot))) < radius) return false;
  }
  for (const croft of crofts) {
    if (circleIntersectsPolygon(centre, radius, croft.polygon)) return false;
  }
  for (const field of fields) {
    if (circleIntersectsPolygon(centre, radius, field.polygon)) return false;
  }
  return true;
}

/**
 * §7.4/§8.3: stone circle -- biome-agnostic (re-tinted, never substituted),
 * so no `resolveGlyphFor` here, unlike the well. Rolled ONCE, always. On a
 * true roll, up to STONE_CIRCLE_BEARING_TRIES bearings are tried on a ring
 * of `dressedRadiusM x STONE_CIRCLE_RADIUS_FACTOR` from the green; the
 * first whose 15 m-radius footprint clears every lane corridor, lot claim,
 * croft, field strip, water polygon, and vegetation position (within
 * STONE_CIRCLE_VEG_CLEAR_M) wins. No bearing clears -> no stone circle
 * (fail soft, §8.5) -- trees are never removed to make room.
 *
 * Fix wave (2026-08-21, C1): `dressedRadiusM` is the MEASURED outer edge of
 * everything already on the ground -- max(fields' outer radius, the fabric
 * radius `computeInnerRadius` measures) -- not the PREDICTED built radius.
 * Keyed off the prediction, the ring landed 2.5-3x inside the real fabric
 * and fields, so all 12 bearings were rejected in 29 of 30 measured
 * placements: the stone circle effectively never placed. The factor is a
 * modest step OUTSIDE that measured edge, not a multiple of a prediction.
 */
export function placeStoneCircle(
  green: Green, dressedRadiusM: number, lanes: Lane[], lots: Lot[], crofts: Croft[],
  fields: FieldStrip[], water: Point[][], vegetation: Vegetation[], rng: SeededRandom,
): Poi | null {
  if (!rng.bool(STONE_CIRCLE_CHANCE)) return null;
  const glyph = 'sm-stone-circle';
  if (!hasGlyph(glyph)) return null;

  const radius = dressedRadiusM * STONE_CIRCLE_RADIUS_FACTOR;
  for (let i = 0; i < STONE_CIRCLE_BEARING_TRIES; i++) {
    const bearingDeg = rng.int(0, 360);
    const dir = bearingVector(bearingDeg);
    const position = new Point(green.centre.x + dir.x * radius, green.centre.y + dir.y * radius);

    if (!circleClearOfClaims(position, STONE_CIRCLE_FOOTPRINT_RADIUS_M, lanes, lots, crofts, fields)) {
      continue;
    }
    if (water.some((ring) => circleIntersectsPolygon(position, STONE_CIRCLE_FOOTPRINT_RADIUS_M, ring))) {
      continue;
    }
    const vegConflict = vegetation.some(
      (v) => dist(position, v.position) < STONE_CIRCLE_FOOTPRINT_RADIUS_M + STONE_CIRCLE_VEG_CLEAR_M,
    );
    if (vegConflict) continue;

    return {
      id: 'poi:stone-circle', kind: 'stone-circle', glyph, position, bearingDeg: 0,
    };
  }
  return null;
}

interface ShorePoint { ring: Point[]; acc: number[]; s: number; point: Point; distance: number }

/** Closest point on ANY water ring's edge to `centre`, with its arc-length
 * position along that ring (ring closed by re-appending its first point). */
function nearestShorePoint(centre: Point, water: Point[][]): ShorePoint | null {
  let best: ShorePoint | null = null;
  for (const ring of water) {
    if (ring.length < 2) continue;
    const closed = [...ring, ring[0]];
    const acc = arcLengths(closed);
    for (let i = 0; i < ring.length; i++) {
      const a = closed[i];
      const b = closed[i + 1];
      const q = closestPointOnSegment(centre, a, b);
      const d = dist(centre, q);
      if (!best || d < best.distance) {
        best = { ring, acc, s: acc[i] + dist(a, q), point: q, distance: d };
      }
    }
  }
  return best;
}

/** The perpendicular to the shore's local direction that points INLAND
 * (away from water) at `edgePoint`. Tested locally rather than assumed
 * (unlike the well's single-lane case, a shore can curve, so the sign is
 * not constant along its length). */
function inlandDirectionAt(edgePoint: Point, dirDeg: number, water: Point[][]): Point {
  const segDir = bearingVector(dirDeg);
  const perp = new Point(-segDir.y, segDir.x);
  const probe = new Point(edgePoint.x + perp.x * 0.5, edgePoint.y + perp.y * 0.5);
  return inAnyWater(probe, water) ? new Point(-perp.x, -perp.y) : perp;
}

/** Nearest-first slide offsets: 0, +step, -step, +2*step, -2*step, ... */
function slideOffsets(range: number, step: number): number[] {
  const offsets = [0];
  for (let k = step; k <= range + 1e-9; k += step) offsets.push(k, -k);
  return offsets;
}

/**
 * §7.4/§8.4: boathouse -- only when a water polygon edge comes within
 * `shorefrontReachM` of the green centre. That reach is the MEASURED fabric
 * radius x SHOREFRONT_REACH_FACTOR (fix wave, C2: the constant is kept, what
 * it multiplies changed -- the predicted built radius under-reports the real
 * fabric 2.5-3x). Positioned on
 * the shore point nearest the green, offset inland by half the footprint
 * depth plus 0.5 m, facing the water. If that intrudes on a lane/lot/croft/
 * field, slides along the shore (nearest-first, +/-BOATHOUSE_SLIDE_RANGE_M
 * at BOATHOUSE_SLIDE_STEP_M pitch) to the first clear spot; none clear ->
 * no boathouse. `sm-boathouse--coastal` is the only variant in the manifest
 * and is used regardless of biome once the shore rule fires.
 *
 * DOOR CONVENTION: reuses `dwellings.ts`'s `renderBearingFor`, the same
 * +180 flip that turns a house's glyph-south door onto its lane. Here the
 * "lane" the boathouse faces is the water: `bearingOf(position, edgePoint)`
 * is the bearing FROM the boathouse TO the water, playing the same role as
 * a lot's `bearingDeg` (which points AT the lane a dwelling faces) --
 * `renderBearingFor` then flips it so the door lands on the water side.
 */
export function placeBoathouse(
  site: Site, green: Green, shorefrontReachM: number,
  lanes: Lane[], lots: Lot[], crofts: Croft[], fields: FieldStrip[],
): Poi | null {
  if (site.water.length === 0) return null;
  const nearest = nearestShorePoint(green.centre, site.water);
  if (!nearest) return null;
  if (nearest.distance > shorefrontReachM) return null;

  const glyph = 'sm-boathouse--coastal';
  if (!hasGlyph(glyph)) return null;
  const [w, d] = nominalFootprint(glyph);
  const clearRadius = Math.max(w, d) / 2;
  const inlandOffset = 0.5 + d / 2;

  const total = nearest.acc[nearest.acc.length - 1];
  const closedRing = [...nearest.ring, nearest.ring[0]];

  for (const off of slideOffsets(BOATHOUSE_SLIDE_RANGE_M, BOATHOUSE_SLIDE_STEP_M)) {
    const s = nearest.s + off;
    if (s < 0 || s > total) continue;
    const sample = sampleAt(closedRing, nearest.acc, s);
    const inlandDir = inlandDirectionAt(sample.p, sample.dirDeg, site.water);
    const position = new Point(
      sample.p.x + inlandDir.x * inlandOffset,
      sample.p.y + inlandDir.y * inlandOffset,
    );

    if (!circleClearOfClaims(position, clearRadius, lanes, lots, crofts, fields)) continue;

    const bearingToWater = bearingOf(position, sample.p);
    return {
      id: 'poi:boathouse',
      kind: 'boathouse',
      glyph,
      position,
      bearingDeg: renderBearingFor(glyph, bearingToWater),
    };
  }
  return null;
}

/**
 * §7.4: the whole POI stage for one village. Called LAST among dressing
 * stages -- after edgeStyle/crofts/fields/vegetation -- so every rng draw
 * here comes after all of theirs, never reordered or interleaved.
 *
 * Both radii are MEASURED, never predicted (fix wave, C1/C2):
 * `dressedRadiusM` = max(fields' outer radius, measured fabric radius) is
 * the stone circle's ring; `shorefrontReachM` = measured fabric radius x
 * SHOREFRONT_REACH_FACTOR is the boathouse's shore reach.
 */
export function buildPois(
  site: Site, green: Green, lanes: Lane[], lots: Lot[], crofts: Croft[], fields: FieldStrip[],
  vegetation: Vegetation[], dressedRadiusM: number, shorefrontReachM: number, rng: SeededRandom,
): Poi[] {
  const pois: Poi[] = [];

  if (site.population >= WELL_MIN_POP) {
    const well = placeWell(green, lanes, site.biome);
    if (well) pois.push(well);
  }

  const stoneCircle = placeStoneCircle(
    green, dressedRadiusM, lanes, lots, crofts, fields, site.water, vegetation, rng,
  );
  if (stoneCircle) pois.push(stoneCircle);

  const boathouse = placeBoathouse(site, green, shorefrontReachM, lanes, lots, crofts, fields);
  if (boathouse) pois.push(boathouse);

  return pois;
}
