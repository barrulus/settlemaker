import { Point } from '../types/point.js';
import type { GenerationParams, RoadEntry, RouteKind, RouteRelief } from '../generator/generation-params.js';
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
      group?: 'roads' | 'trails';
      through?: boolean;
      relief?: RouteRelief;
      followsRiver?: boolean;
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
   * People the walled core may hold. Population beyond this grows outside
   * the walls along roads. Default DEFAULT_CORE_CAPACITY (10 000) — walls
   * historically enclosed a core, not an entire metropolis.
   */
  coreCapacity?: number;
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
 * and task-2-report.md, including its "Fix round 1" section). Latitude
 * [120, 400]. Calibration surfaced a pre-existing (not Task-2-introduced)
 * `findCircumference` defect: its boundary walk (`model.ts`'s
 * `findCircumference`, ~line 1071) could enter a cycle that never revisits
 * index 0, growing its result array unboundedly — observed as an 11.2 s
 * hang ending in `RangeError: Invalid array length` at cap 250. That, not
 * per-retry cost, was the actual 8 s-budget tail (an earlier pass at this
 * comment mis-attributed it to O(n²) retry cost; a terminating enclosure
 * retry costs single-digit milliseconds). Fixed with a termination guard in
 * the walk itself (throws into the existing retry ladder instead of
 * spinning) plus an enclosure check in `Model.buildWalls` for the rarer case
 * where the walk terminates but on the wrong (too-small) boundary. With both
 * guards in place, a 60-seed stress test at pop 200000 (which always
 * saturates the cap) at MAX_PATCHES=220 measured a worst case of 4.9 s and
 * 0/60 over-budget runs — see task-2-report.md for the full table. 220 was
 * chosen over a smaller value in the latitude because it's the smallest cap
 * that still keeps pop 70000 (uncapped nPatches 195) strictly below pop
 * 200000's (capped at 220), preserving the Aldford series' distinct
 * footprints all the way to the top of the calibrated population range. */
export const MAX_PATCHES = 220;

/** People a walled core holds unless the caller says otherwise. */
export const DEFAULT_CORE_CAPACITY = 10000;

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
 * Fraction of `population` that lives outside the walls even when the
 * settlement is nowhere near `coreCapacity`. Faubourgs outside the gates
 * and ribbon development along the approach roads were normal at every
 * size, not just above the cap — `min(population, coreCapacity)` and
 * `population` are the SAME expression for any burg at or below the cap,
 * so without this a naive core sizing makes the sprawl budget
 * (`nPatches - nCore`) evaluate to exactly zero and every settlement under
 * `coreCapacity` becomes 100% intramural (a real defect in the first
 * implementation — 84 measured runs across pop 400-10000 x seeds 1-12
 * produced zero suburb/satellite patches).
 *
 * `~10%` outside at population 300, rising log-linearly to `20%` at
 * population 10000 (`DEFAULT_CORE_CAPACITY`), where the cap itself takes
 * over as the binding constraint — continuous across that boundary, so
 * nothing changes abruptly there.
 *
 * Owner decision 2026-08-09 (replaces the 20-45% curve from round 4 task 6):
 * most people stay INSIDE the walls at below-cap sizes, and the walled
 * interior packs tight (Saint-Malo-style), rather than a large share
 * draining out to a suburb ring. Growth outside the walls is sparse and
 * asymmetric, not a uniform skirt. See
 * docs/superpowers/sdd/2026-08-09-round-cores-faubourgs/ for the full spec.
 */
export function extramuralShare(population: number): number {
  // 10% at pop 300 rising log-linearly to 20% at DEFAULT_CORE_CAPACITY
  // (10 000), where the capacity ceiling takes over as the binding
  // constraint. Owner decision 2026-08-09 (replaces the 20-45% curve):
  // most people stay inside; growth outside is sparse and asymmetric.
  const raw = 0.10 + 0.0657 * (Math.log10(population) - Math.log10(300));
  return Math.min(0.20, Math.max(0.10, raw));
}

/**
 * Patches in the walled core. `coreCapacity` is a ceiling, not a target.
 *
 * Fix round 3: the first version computed this as
 * `populationToPatches(min(population * (1 - extramuralShare(population)),
 * coreCapacity))` — a SECOND, independently-rounded call to
 * `populationToPatches` against a scaled-down population. Because
 * `nPatches` (the caller's own `populationToPatches(population)`) and this
 * value round `households / perPatchDensity` at different granularities,
 * their difference (the sprawl budget, `nPatches - nCore`) could land on
 * exactly zero even when `extramuralShare` was clearly non-zero — measured:
 * 11 of 140 populations swept 100-14000 in steps of 100 hit `nCore >=
 * nPatches`, and every walled burg in those bands produced gate-ward
 * outskirts only, no real corridor sprawl, at ANY seed.
 *
 * Fixed at the root: derive the sprawl patch count directly from `nPatches
 * * extramuralShare(population)`, floored at 1, and subtract that from
 * `nPatches` — a single rounding step that can never land on zero while
 * the share is non-zero. `coreCapacity`'s ceiling is then a SEPARATE,
 * population-independent cap (`populationToPatches(coreCapacity)` — patches
 * for a settlement whose population IS the capacity, not further scaled by
 * `extramuralShare`): the smaller of the two governs, so the ceiling still
 * binds once `population` runs far enough past `coreCapacity` that the
 * share-based core would otherwise keep growing (a 250000-person city's
 * core does not grow past what `coreCapacity` alone allows).
 */
export function corePatchCount(
  population: number,
  coreCapacity: number,
  urbanDensity?: number,
): number {
  const nPatches = populationToPatches(population, urbanDensity);
  const sprawlPatches = Math.max(1, Math.round(nPatches * extramuralShare(population)));
  const shareBasedCore = nPatches - sprawlPatches;
  const capacityCeiling = populationToPatches(coreCapacity, urbanDensity);
  // Clamped to nPatches too (belt-and-braces, per the existing
  // non-monotonicity guard in mapToGenerationParams) — shareBasedCore is
  // already <= nPatches - 1 by construction, but capacityCeiling alone
  // (populationToPatches on a different population) is not.
  return Math.min(shareBasedCore, capacityCeiling, nPatches);
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
    return { point, bearingDeg, routeId: b.route_id, kind: b.kind, group: b.group, through: b.through, relief: b.relief, followsRiver: b.followsRiver };
  });

  const nPatches = populationToPatches(burg.population, burg.urbanDensity);
  const nCoreUnclamped = corePatchCount(
    burg.population,
    burg.coreCapacity ?? DEFAULT_CORE_CAPACITY,
    burg.urbanDensity,
  );
  // Clamp nCore to not exceed nPatches. populationToPatches is not monotonic
  // in population: households = round(p / density) and perPatchDensity(p) step
  // at different granularities, so a clamped (smaller) population can land on
  // a local peak and yield more patches than the unclamped version.
  const nCore = Math.min(nCoreUnclamped, nPatches);

  return {
    nPatches,
    nCore,
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
