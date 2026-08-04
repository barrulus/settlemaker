import { Point } from '../types/point.js';
import type { GenerationParams, RoadEntry, RouteKind } from '../generator/generation-params.js';

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

/**
 * Calibration: observed ordinary-buildings-per-patch at default minSq.
 * Task 6 of this plan may tune within [7, 12] after visual review.
 */
export const BUILDINGS_PER_PATCH = 9;

/**
 * Patch count derives from the household target (pop / urbanDensity) so the
 * settlement's footprint scales with how many buildings it must hold —
 * "looks like a home for X people". Floor 3 keeps tiny meshes viable
 * (Voronoi with <3 patches degenerates); cap 60 bounds cost for
 * metropolises, where the adaptive minSq refinement makes up the rest.
 */
function populationToPatches(population: number, urbanDensity?: number): number {
  const households = Math.max(2, Math.round(population / (urbanDensity ?? 4)));
  return Math.max(3, Math.min(60, Math.ceil(households / BUILDINGS_PER_PATCH)));
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
    plazaNeeded: burg.plaza,
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
