import { Point } from '../types/point.js';
import type { GenerationParams, RoadEntry, RouteKind } from '../generator/generation-params.js';
import { densityCurve, perPatchDensity } from '../generator/generation-params.js';

/**
 * A road bearing either as a plain compass angle (back-compat) or a richer record
 * carrying the caller's route_id so questables-style consumers can round-trip
 * the matched route on each gate output feature.
 */
export type RoadBearingInput =
  | number
  | {
      bearing_deg: number;
      route_id?: string;
      kind?: RouteKind;
    };

/**
 * Input data from Azgaar's Fantasy Map Generator (maps_burgs table).
 */
export interface AzgaarBurgInput {
  name: string;
  population: number;
  port: boolean;
  citadel: boolean;
  walls: boolean;
  plaza: boolean;
  temple: boolean;
  shanty: boolean;
  capital: boolean;
  culture?: string;
  elevation?: number;
  temperature?: number;
  /**
   * Compass bearings (degrees, 0=N clockwise) of roads approaching the burg.
   * Bare numbers work for back-compat; pass objects to have the matched
   * `route_id` echoed back on the gate output feature.
   */
  roadBearings?: RoadBearingInput[];
  /** Compass bearing (degrees, 0=N clockwise) to nearest ocean — enables coastline clipping for port cities */
  oceanBearing?: number;
  /** Harbour size for port cities — 'large' for major sea routes + big pop, 'small' otherwise */
  harbourSize?: 'large' | 'small';
  /** People per household — FMG's urbanDensityInput. Drives the building budget. */
  urbanDensity?: number;
  /** Azgaar biome name (e.g. "desert", "temperate") — selects default asset set + palette. */
  biome?: string;
  /** Trade-center burg — guarantees a market/plaza ward (Azgaar wishlist). */
  trade?: boolean;
  /**
   * Water polygons surrounding the burg, in burg-local coordinates (origin at
   * burg centre, same scale as the generated mesh — roughly the wall radius).
   * Each entry is a closed polygon of water (ocean, lake, cove, etc.); a patch
   * whose centroid lies inside any polygon is classified as water.
   *
   * When set, this replaces the `oceanBearing` half-plane heuristic with
   * fidelity-preserving classification against the actual world geometry.
   * `oceanBearing` remains an acceptable fallback when vector coastlines are
   * not available.
   */
  coastlineGeometry?: Array<Array<{ x: number; y: number }>>;
}

/** Hard footprint cap, chosen from round-4 calibration against the ≤8 s
 * generation budget (see docs/superpowers/plans/2026-08-05-fidelity-round-4.md
 * and task-2-report.md). Latitude [120, 400] — landed at the floor, not the
 * brief's suggested 250, because calibration surfaced a pre-existing (not
 * Task-2-introduced) `findCircumference`/`buildWalls` defect: on certain
 * seed/patch-count draws it used to silently return an undersized wall
 * polygon instead of throwing (fixed in `Model.buildWalls` with an enclosure
 * check — see its comment), which now correctly retries instead, but each
 * retry's cost scales with patch count (the O(n²) circumference walk), so
 * above ~150-180 patches occasional retries can push a single generation
 * past the 8 s budget. A 60-seed stress test at pop 200000 (which always
 * saturates the cap) measured a worst case of 12.4 s and 2/60 over-budget
 * runs at cap 220, 9.7 s and 1/60 at cap 180, vs. zero over-budget runs and
 * a tight ~3.2-4.1 s spread across 33+ seeds at cap 120 — see task-2-report.md
 * for the full tables. Optimizing `findCircumference` to avoid the O(n²)
 * cost (making retries cheap regardless of n) would let this cap move back
 * up the latitude; that's out of this task's scope. */
export const MAX_PATCHES = 120;

/**
 * Patch count derives from the household target (pop / urbanDensity) so the
 * settlement's footprint scales with how many buildings it must hold —
 * "looks like a home for X people". Floor 3 keeps tiny meshes viable
 * (Voronoi with <3 patches degenerates); cap MAX_PATCHES bounds cost for
 * metropolises, where the adaptive minSq refinement makes up the rest.
 */
function populationToPatches(population: number, urbanDensity?: number): number {
  const households = Math.max(2, Math.round(population / (urbanDensity ?? densityCurve(population))));
  return Math.max(3, Math.min(MAX_PATCHES, Math.ceil(households / perPatchDensity(population))));
}

/**
 * Convert Azgaar burg data into generation parameters.
 * Uses a hash of the burg name as the random seed for deterministic output.
 */
export function mapToGenerationParams(
  burg: AzgaarBurgInput,
  seedOverride?: number,
): GenerationParams {
  const seed = seedOverride ?? hashString(burg.name);

  const roadEntryPoints: RoadEntry[] | undefined = burg.roadBearings?.map(b => {
    const bearingDeg = typeof b === 'number' ? b : b.bearing_deg;
    const rad = bearingDeg * Math.PI / 180;
    const point = new Point(Math.sin(rad), -Math.cos(rad));
    if (typeof b === 'number') return { point, bearingDeg };
    return { point, bearingDeg, routeId: b.route_id, kind: b.kind };
  });

  return {
    nPatches: populationToPatches(burg.population, burg.urbanDensity),
    population: burg.population,
    plazaNeeded: burg.plaza || burg.trade === true,
    citadelNeeded: burg.citadel,
    wallsNeeded: burg.walls,
    templeNeeded: burg.temple,
    shantyNeeded: burg.shanty,
    capitalNeeded: burg.capital,
    seed,
    ...(roadEntryPoints != null ? { roadEntryPoints } : {}),
    ...(burg.oceanBearing != null ? { oceanBearing: burg.oceanBearing } : {}),
    ...(burg.harbourSize != null ? { harbourSize: burg.harbourSize } : {}),
    ...(burg.urbanDensity != null ? { urbanDensity: burg.urbanDensity } : {}),
    ...(burg.biome != null ? { biome: burg.biome } : {}),
    ...(burg.coastlineGeometry != null
      ? { coastlineGeometry: burg.coastlineGeometry.map(ring => ring.map(p => new Point(p.x, p.y))) }
      : {}),
  };
}

/** Simple string hash (djb2) for deterministic seeding */
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) & 0x7fffffff;
  }
  return hash || 1; // avoid zero seed
}
