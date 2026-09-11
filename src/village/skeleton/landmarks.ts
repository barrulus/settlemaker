import { assertWaterQuery } from '../water-boundary.js';
import { frontageOffsetM } from '../cross-section.js';
import { intrudesOnLane, renderBearingFor } from '../dwellings.js';
import { classRank } from '../route-class.js';
import { buildingId, type Building } from '../types.js';
import { isTrunk } from './trunks.js';
/** Landmarks reserve their own ground before ordinary homes are seated.
 * Faith buildings choose central sites; inns choose visible regional frontage
 * near the village entrance or its centre, never a lane merely sorted first. */
import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import {
  LANDMARK_BAND, LANDMARK_OBSTACLE_MARGIN_M, LANDMARK_SITE_STEP_M
} from '../constants.js';
import { resolveGlyphFor } from '../deck.js';
import {
  arcLengths, bearingVector, closestPointOnSegment, dist, greenDrawnRadius, inAnyWater, sampleAt,
  segmentIntersection,
} from '../geometry.js';
import { hasGlyph, inkExtent, nominalFootprint } from '../glyphs.js';
import { lotObb, obbOverlap, type Obb } from '../parcels/overlap.js';
import { offsetPolyline } from '../parcels/strip.js';
import type { Green, Lane, Lot, Site } from '../types.js';

export type LandmarkKind = 'faith' | 'inn' | 'manor';

export interface Landmark {
  /** The reserved ground -- fronts a lane exactly like an ordinary lot,
   * but minted at the glyph's own footprint, uncapped. */
  lot: Lot;
  /** Resolved for the biome. */
  glyph: string;
  /** Heads housed; 0 for a faith building. */
  occupancy: number;
  kind: LandmarkKind;
}

/** Prominent buildings fit their reserved claims exactly. Random size and
 * bearing jitter must not invalidate the site after its safety checks. */
export function seatLandmark(landmark: Landmark): Building {
  const { lot, glyph, occupancy } = landmark;
  const footprint = nominalFootprint(glyph), inward = bearingVector(lot.bearingDeg + 180);
  const offset = inkExtent(glyph, footprint).depth / 2 + 0.5;
  return {
    id: buildingId(lot.id), lotId: lot.id, glyph, footprint, occupancy,
    position: new Point(lot.front.x + inward.x * offset, lot.front.y + inward.y * offset),
    bearingDeg: renderBearingFor(glyph, lot.bearingDeg, 0, false)
  };
}

interface LandmarkSpec {
  kind: LandmarkKind;
  glyph: string;
  minPop: number;
  occupancy: number;
}

/**
 * 2026-09-08: the faith glyphs were renamed to proper `sm-chapel--<biome>`
 * variants (sm-shrine--desert -> sm-chapel--desert, etc; confirmed one
 * family by their footprints), so faith now resolves through the SAME
 * mechanism as the inn -- `resolveGlyphFor`'s suffix table -- and needs no
 * per-biome table of its own. `sm-temple` is the one exception: a
 * temperate-only step-up at `minPop` 700, with no biome variants of its
 * own, so it is never run through `resolveGlyphFor`.
 */
function faithSpecFor(site: Site): LandmarkSpec {
  if (site.biome === 'temperate' && site.population >= 700) {
    return { kind: 'faith', glyph: 'sm-temple', minPop: 700, occupancy: 0 };
  }
  return { kind: 'faith', glyph: resolveGlyphFor(site.biome, 'sm-chapel'), minPop: 300, occupancy: 0 };
}

/**
 * The catalogue, in the fixed placement order the design calls for: faith,
 * then inn, then manor. Each entry's glyph is resolved for the biome
 * (`sm-cathedral` deliberately excluded -- it is city-scale and the
 * village population ceiling is 1000, so it can never legitimately place).
 */
function specsFor(site: Site): LandmarkSpec[] {
  return [
    faithSpecFor(site),
    { kind: 'inn', glyph: resolveGlyphFor(site.biome, 'sm-inn'), minPop: 180, occupancy: 6 },
    { kind: 'manor', glyph: resolveGlyphFor(site.biome, 'sm-house-large-tiled'), minPop: 250, occupancy: 6 },
  ];
}

function laneSetback(lane: Lane): number {
  return frontageOffsetM(lane);
}

/** Closest point ON `obb`'s boundary/interior to `p` (clamped projection),
 * used for the claim-vs-green-circle test. A private copy of the same
 * small helper `dressing/pois.ts` keeps for its own well-nudging -- this
 * module deliberately does not import from `dressing/` (a siting pass
 * should not depend on a dressing pass). */
function closestPointOnObb(p: Point, obb: Obb): Point {
  const d = new Point(p.x - obb.center.x, p.y - obb.center.y);
  const alongT = Math.max(-obb.halfW, Math.min(obb.halfW, d.x * obb.tangent.x + d.y * obb.tangent.y));
  const alongN = Math.max(-obb.halfD, Math.min(obb.halfD, d.x * obb.normal.x + d.y * obb.normal.y));
  return new Point(
    obb.center.x + obb.tangent.x * alongT + obb.normal.x * alongN,
    obb.center.y + obb.tangent.y * alongT + obb.normal.y * alongN,
  );
}

function overlapsGreen(obb: Obb, green: Green): boolean {
  const nearest = closestPointOnObb(green.centre, obb);
  return dist(nearest, green.centre) < greenDrawnRadius(green);
}

/** The claim's four corners plus its centre -- enough coverage to catch a
 * claim that dips into water without walking every edge pixel. */
function obbSamplePoints(obb: Obb): Point[] {
  const { center, tangent, normal, halfW, halfD } = obb;
  const corner = (sw: number, sd: number): Point => new Point(
    center.x + tangent.x * halfW * sw + normal.x * halfD * sd,
    center.y + tangent.y * halfW * sw + normal.y * halfD * sd,
  );
  return [center, corner(1, 1), corner(1, -1), corner(-1, 1), corner(-1, -1)];
}

/**
 * Full edge-crossing test, not just the five sample points -- a narrow
 * stream (AFMG's brook is 4 m) can slice straight through the MIDDLE of a
 * landmark's large claim (up to 22x17) without ever touching a corner or
 * the centre, which `obbSamplePoints` alone would miss entirely. Measured
 * directly: all three landmarks sited into the water on the `brook`
 * fixture before this fix, corners-and-centre all dry, the water crossing
 * through the claim's interior. Mirrors `claimTouchesWater`
 * (parcels/lots.ts), the same test `clipLots` already runs for an ordinary
 * lot -- kept as its own copy here rather than imported, matching this
 * module's stated policy of not depending on another pass's internals for
 * a small, self-contained geometry check.
 */
function overlapsWater(obb: Obb, water: Point[][]): boolean {
  assertWaterQuery(water, obb.center, Math.hypot(obb.halfW, obb.halfD));
  if (water.length === 0) return false;
  // obbSamplePoints order: centre, (1,1), (1,-1), (-1,1), (-1,-1) -- reorder
  // the four corners into ring order ((1,1) -> (1,-1) -> (-1,-1) -> (-1,1))
  // for the edge walk below.
  const [center, c1, c2, c4, c3] = obbSamplePoints(obb);
  if ([center, c1, c2, c3, c4].some((p) => inAnyWater(p, water))) return true;
  const ring = [c1, c2, c3, c4];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    for (const w of water) {
      for (let j = 0; j < w.length; j++) {
        if (segmentIntersection(a, b, w[j], w[(j + 1) % w.length])) return true;
      }
    }
  }
  return false;
}

/**
 * True when the claim comes within `LANDMARK_OBSTACLE_MARGIN_M` of ANY
 * trunk OTHER than the one it fronts -- e.g. a loop's two arms passing
 * close together, or two trunks converging near the green. The lane it
 * fronts is exempt: that clearance is already the whole point of
 * `laneSetback`, and re-testing it here would reject every legitimate
 * site. Growth's own obstacle avoidance (`village-model.ts`, wired from
 * this claim) only keeps a NEW lane from crossing the claim outline; this
 * is the other half, keeping the claim off ground an EXISTING trunk
 * already runs close to, which growth can never fix by itself (a trunk
 * lane is never shortened -- it is the FMG route contract). Measured
 * directly: a loop village sited an inn's claim clear of its own fronting
 * arm but 6 m from the loop's OTHER arm, close enough for the finished
 * building to intrude on it.
 */
function overlapsOtherLane(obb: Obb, trunks: Lane[], ownLaneId: string): boolean {
  for (const lane of trunks) {
    if (lane.id === ownLaneId) continue;
    const r = lane.widthM / 2 + LANDMARK_OBSTACLE_MARGIN_M;
    for (const p of obbSamplePoints(obb)) {
      for (let i = 1; i < lane.points.length; i++) {
        if (dist(p, closestPointOnSegment(p, lane.points[i - 1], lane.points[i])) < r) return true;
      }
    }
  }
  return false;
}


/** `landmark:<kind>:<laneId>:<R|L><ordinal>` -- follows the same
 * `<laneId>:<side><ordinal>` shape `lotId` (types.ts) uses for an ordinary
 * lot, prefixed so a landmark claim is never mistaken for one at a glance
 * in a render or a probe. `ordinal` counts samples tried along this
 * (lane, side), so ids stay stable and unique without needing a global
 * counter tied to draw order. */
function claimId(kind: LandmarkKind, laneId: string, side: 1 | -1, ordinal: number): string {
  return `landmark:${kind}:${laneId}:${side === 1 ? 'R' : 'L'}${ordinal}`;
}

/** Rank every feasible roadside claim by the landmark's role. Candidate
 * enumeration is deterministic; lane IDs break ties, never decide priority. */
function siteOne(
  spec: LandmarkSpec, lanesSorted: Lane[], green: Green, site: Site, builtRadiusM: number,
  placed: Obb[],
): Lot | null {
  const [frontageM, depthM] = nominalFootprint(spec.glyph);
  const [lo, hi] = LANDMARK_BAND[spec.kind];
  const bandLoM = lo * builtRadiusM;
  const bandHiM = hi * builtRadiusM;

  let best: { lot: Lot; score: number; } | undefined;
  for (const lane of lanesSorted) {
    const setback = laneSetback(lane);
    for (const side of [1, -1] as const) {
      const edge = offsetPolyline(lane.points, setback, side);
      if (edge.length < 2) continue;
      const edgeAcc = arcLengths(edge);
      const edgeTotal = edgeAcc[edgeAcc.length - 1];

      let ordinal = 0;
      for (let s = LANDMARK_SITE_STEP_M; s <= edgeTotal; s += LANDMARK_SITE_STEP_M, ordinal++) {
        const { p, dirDeg } = sampleAt(edge, edgeAcc, s);
        const d = dist(p, green.centre);
        if (d < bandLoM || d > bandHiM) continue;

        // Same inward-normal convention as subdivideLane (parcels/lots.ts):
        // the lot faces back across the strip to its lane.
        const bearingDeg = (dirDeg + (side === 1 ? -90 : 90) + 360) % 360;
        const lot: Lot = {
          id: claimId(spec.kind, lane.id, side, ordinal),
          laneId: lane.id,
          side,
          front: p,
          bearingDeg,
          frontageM,
          depthM,
          score: 0,
        };
        const obb = lotObb(lot);
        if (overlapsGreen(obb, green)) continue;
        if (overlapsWater(obb, site.water)) continue;
        if (placed.some((other) => obbOverlap(obb, other))) continue;
        if (overlapsOtherLane(obb, lanesSorted, lane.id)) continue;

        const regional = isTrunk(lane.id);
        const score = spec.kind === 'faith' ? dist(obb.center, green.centre)
          : spec.kind === 'inn'
            ? (regional ? 0 : builtRadiusM * 4) + classRank(lane.type) * 2
            + Math.min(d * 0.6, Math.abs(d - builtRadiusM * 0.75))
            : Math.abs(d - builtRadiusM * 1.05);
        if (best && score >= best.score) continue;
        if (intrudesOnLane(seatLandmark({ lot, glyph: spec.glyph, kind: spec.kind, occupancy: spec.occupancy }), lanesSorted)) continue;
        best = { lot, score };
      }
    }
  }
  return best?.lot ?? null;
}

/** True for a landmark's own lot id (`landmark:<kind>:<laneId>:<R|L><n>`) --
 * never mistaken for an ordinary `lotId` (see `claimId` above and `lotId`
 * in `types.ts`). Exported so `village-model.ts` can exempt a landmark's
 * ground from the end-of-pipeline filters an ordinary lot is held to (a
 * landmark's claim is legitimately wider/deeper than any of those checks
 * were written to expect). */
export function isLandmarkLot(lotId: string): boolean {
  return lotId.startsWith('landmark:');
}

/**
 * How many landmarks this village's population and biome will earn, with NO
 * geometry involved -- just `specsFor`'s population floor and manifest
 * presence. `generateVillage` needs this BEFORE the trunk network (and so
 * before any candidate site) exists, to size the disc closed-form the same
 * way it always has: a village whose census needs N ordinary dwellings plus
 * its landmarks needs room for all of it, not just the houses. Kept here
 * rather than duplicated in `village-model.ts` because the eligibility rule
 * (population floor, per-kind glyph resolution) belongs with the rest of
 * the landmark catalogue, in exactly one place.
 */
export function landmarkCandidateCount(site: Site): number {
  return specsFor(site).filter((s) => site.population >= s.minPop && hasGlyph(s.glyph)).length;
}


/**
 * Site every landmark the village's population and biome earn, in order:
 * faith, then inn, then manor. Pure and deterministic -- `rng` is accepted
 * for symmetry with every other siting pass in this package and because a
 * future tie-break may want it, but nothing here draws from it (a claim
 * fully wins or loses on band/green/water/overlap, so there is nothing to
 * break a tie on yet; drawing anyway would shift the shared stream and
 * re-roll every existing village for no behavioural gain).
 */
export function siteLandmarks(
  site: Site, green: Green, trunks: Lane[], builtRadiusM: number, rng: SeededRandom,
): { landmarks: Landmark[]; diagnostics: string[]; } {
  void rng;
  const diagnostics: string[] = [];
  const landmarks: Landmark[] = [];
  const placed: Obb[] = [];
  const lanesSorted = [...trunks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const spec of specsFor(site)) {
    if (site.population < spec.minPop) continue;
    if (!hasGlyph(spec.glyph)) {
      diagnostics.push(
        `landmark ${spec.kind}: glyph "${spec.glyph}" not in manifest, skipped`,
      );
      continue;
    }
    const lot = siteOne(spec, lanesSorted, green, site, builtRadiusM, placed);
    if (!lot) {
      diagnostics.push(
        `landmark ${spec.kind}: no site cleared band [${LANDMARK_BAND[spec.kind].join(', ')}]`
        + ` x builtRadiusM, green, water and prior claims across ${trunks.length} lane(s), skipped`,
      );
      continue;
    }
    placed.push(lotObb(lot));
    landmarks.push({ lot, glyph: spec.glyph, occupancy: spec.occupancy, kind: spec.kind });
  }

  return { landmarks, diagnostics };
}
