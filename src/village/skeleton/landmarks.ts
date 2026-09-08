/**
 * Landmark siting (owner's ruling, 2026-09-08): "landmarks should get their
 * own ground, like the green does." Village lots are cut along lanes with a
 * hard width cap (`MAX_LOT_FRONTAGE_RATIO` x the widest dwelling) and a
 * fixed depth (`LOT_DEPTH_M`), so every glyph bigger than a dwelling is
 * structurally unplaceable by the ordinary cutter -- measured: `sm-inn`
 * (17x15) and `sm-temple` (22x17) placed in ZERO of 180 generated villages.
 *
 * The fix does not touch the cutter at all. A landmark's claim IS a `Lot`
 * (see types.ts) -- nothing in that type constrains `frontageM`/`depthM` to
 * the subdivider's caps, those caps live entirely in `subdivideLane`. Mint
 * the claim directly at the glyph's own footprint and every existing
 * lot-avoider (crofts, fields, vegetation, POI clearance) avoids it for
 * free, because to them it just looks like a lot.
 *
 * This module only SITES landmarks and returns claims -- it does not touch
 * `village-model.ts`'s pipeline (a later pass wires it in, presumably
 * before `subdivideLane` walks the same lanes so it can treat a landmark's
 * ground as already spoken for).
 */
import { SeededRandom } from '../../utils/random.js';
import { Point } from '../../types/point.js';
import { arcLengths, dist, greenDrawnRadius, inAnyWater, sampleAt } from '../geometry.js';
import { hasGlyph, nominalFootprint } from '../glyphs.js';
import { resolveGlyphFor } from '../deck.js';
import { offsetPolyline } from '../parcels/strip.js';
import { lotObb, obbOverlap, type Obb } from '../parcels/overlap.js';
import { LANDMARK_BAND, LANDMARK_SITE_STEP_M, LANE_SETBACK_M } from '../constants.js';
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
    { kind: 'manor', glyph: 'sm-house-large-tiled', minPop: 250, occupancy: 6 },
  ];
}

function laneSetback(lane: Lane): number {
  return lane.widthM / 2 + (LANE_SETBACK_M[lane.type] ?? 2);
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

function overlapsWater(obb: Obb, water: Point[][]): boolean {
  if (water.length === 0) return false;
  return obbSamplePoints(obb).some((p) => inAnyWater(p, water));
}

let claimCounter = 0;

/** `landmark:<kind>:<laneId>:<R|L><ordinal>` -- follows the same
 * `<laneId>:<side><ordinal>` shape `lotId` (types.ts) uses for an ordinary
 * lot, prefixed so a landmark claim is never mistaken for one at a glance
 * in a render or a probe. `ordinal` counts samples tried along this
 * (lane, side), so ids stay stable and unique without needing a global
 * counter tied to draw order. */
function claimId(kind: LandmarkKind, laneId: string, side: 1 | -1, ordinal: number): string {
  return `landmark:${kind}:${laneId}:${side === 1 ? 'R' : 'L'}${ordinal}`;
}

/**
 * Try every candidate for one spec, in the fixed deterministic order the
 * design calls for: trunk lanes in id order, each lane's two sides (right
 * of travel, then left), each side sampled from the green end outward at
 * `LANDMARK_SITE_STEP_M`. Returns the FIRST candidate that clears the
 * band, the green, water and every claim already placed this pass -- or
 * null, with the reason left for the caller to report (fail soft, never
 * silently).
 */
function siteOne(
  spec: LandmarkSpec, trunksSorted: Lane[], green: Green, site: Site, builtRadiusM: number,
  placed: Obb[],
): Lot | null {
  const [frontageM, depthM] = nominalFootprint(spec.glyph);
  const [lo, hi] = LANDMARK_BAND[spec.kind];
  const bandLoM = lo * builtRadiusM;
  const bandHiM = hi * builtRadiusM;

  for (const lane of trunksSorted) {
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

        claimCounter++;
        return lot;
      }
    }
  }
  return null;
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
): { landmarks: Landmark[]; diagnostics: string[] } {
  void rng;
  const diagnostics: string[] = [];
  const landmarks: Landmark[] = [];
  const placed: Obb[] = [];
  const trunksSorted = [...trunks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const spec of specsFor(site)) {
    if (site.population < spec.minPop) continue;
    if (!hasGlyph(spec.glyph)) {
      diagnostics.push(
        `landmark ${spec.kind}: glyph "${spec.glyph}" not in manifest, skipped`,
      );
      continue;
    }
    const lot = siteOne(spec, trunksSorted, green, site, builtRadiusM, placed);
    if (!lot) {
      diagnostics.push(
        `landmark ${spec.kind}: no site cleared band [${LANDMARK_BAND[spec.kind].join(', ')}]`
        + ` x builtRadiusM, green, water and prior claims across ${trunks.length} trunk lane(s), skipped`,
      );
      continue;
    }
    placed.push(lotObb(lot));
    landmarks.push({ lot, glyph: spec.glyph, occupancy: spec.occupancy, kind: spec.kind });
  }

  return { landmarks, diagnostics };
}
