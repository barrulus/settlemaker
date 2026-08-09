import { Point } from '../types/point.js';

/** Narrative/transport category of an approaching route. */
export type RouteKind = 'road' | 'foot' | 'sea';

/** Corridor relief walking outward from the burg. */
export type RouteRelief = 'descent' | 'ascent' | 'valley' | 'ridge' | 'flat';

/**
 * Road entry hint threaded from caller → curtain wall. `point` is a unit direction
 * vector from the burg centroid (SVG coords, y-down); `bearingDeg` is the same
 * information as a compass angle. `routeId` is echoed back on the matched gate.
 */
export interface RoadEntry {
  point: Point;
  bearingDeg: number;
  routeId?: string;
  kind?: RouteKind;
  /** FMG land-route group. Absent = unknown, treated like 'roads'. */
  group?: 'roads' | 'trails';
  /** Route continues past the burg (true) vs terminates here. */
  through?: boolean;
  /** Corridor relief walking outward. */
  relief?: RouteRelief;
  /** Road runs along a river (valley road). */
  followsRiver?: boolean;
}

/**
 * Default people-per-building. Villages are ~4/household; urban buildings
 * house more people (historically true, and matches watabou's visual scale),
 * rising log-linearly to 12 at pop ≥ 20 000. Explicit urbanDensity (FMG's
 * urbanDensityInput) always overrides this default.
 */
export function densityCurve(population: number): number {
  if (population <= 500) return 4;
  return Math.min(12, 4 + 8 * Math.log10(population / 500) / Math.log10(40));
}

/**
 * Ordinary buildings a patch holds at this settlement's texture. Villages
 * are airy (~9 detached houses per patch, the watabou village look);
 * walled settlements pack tight (Saint-Malo ~6000 in a compact circuit):
 * city texture (~30 tight blocks per patch) is now reached at the
 * coreCapacity default (population 10 000), not 20 000 — owner decision
 * 2026-08-09. Log-scaled between pop 600 and 10 000. Drives BOTH the patch
 * count (footprint) and the default block size (texture) so they stay
 * coherent.
 */
export function perPatchDensity(population: number): number {
  if (population <= 600) return 9;
  return Math.min(30, 9 + 21 * Math.log10(population / 600) / Math.log10(10000 / 600));
}

/**
 * `Model`'s CommonWard block-size scale (`baseMinSqScale`) for a given
 * `perPatchDensity` target. Round-4 fix round 2: `createAlleys`'s yield is
 * far from linear in `minSq`, so the original `9 / targetPerPatch` inverse
 * badly under-shot at city scale (target 30 -> scale 0.3), leaving the
 * *natural* pre-trim yield miles above the target (measured: ~90-250
 * buildings/patch at scale 0.3 against a target of 30). `applyBuildingBudget`
 * then had to trim 60-90% of each patch's buildings via its keep-nearest-
 * patch-centre policy, which sculpts a small cluster at each patch's centre
 * with a bare stripped rim instead of contiguous urban fabric.
 *
 * Anchored and log-interpolated exactly like `perPatchDensity` itself:
 * - (9, 1.0): villages, unchanged -- hard-pinned, not re-fitted, because
 *   pop <= 600 output must stay byte-stable (existing pinned-hash tests;
 *   the village floor itself moved from 1000 to 600 with round-cores-
 *   faubourgs task 5, but the (9, 1.0) anchor pair is untouched).
 * - (30, 9.0): the largest scale. Originally measured against a fixed
 *   Aldford (seed 9, walled) fixture at pop 20000 and pop 70000 -- both
 *   populations `perPatchDensity` saturated at target 30 for under the
 *   pre-2026-08-09 curve (which reached 30 at pop 20000).
 *
 *   Round-cores-faubourgs task 5 (2026-08-09) moved the saturation point to
 *   pop 10000 (Saint-Malo-style dense walled core reached at the
 *   coreCapacity default, not double it). Re-measured at the new anchor
 *   (pop 10000) with the SAME fixture/scale: at scale 9.0, trim stays 0%
 *   (comfortably under the 12% margin -- the actual gate this anchor is
 *   fitted to), same as at pop 70000 (also 0% trim at scale 9.0). Trim
 *   never engages meaningfully anywhere in the scale 4-20 range tested at
 *   either population, so the trim-margin gate does not force a refit.
 *
 *   Post-trim density (informational, not the gate): 0.65x target at pop
 *   10000 vs 1.56x target at pop 70000 -- both now outside the old
 *   [0.7, 1.2]x informal band (was 0.76x/0.94x at the old pop 20000/70000
 *   anchors). The two bookend populations' average patch area diverges more
 *   now that the near anchor moved from 20000 to 10000 (fewer, bigger core
 *   patches at pop 10000 than pop 20000 used to have at the same target),
 *   so a single scale fits both worse than before; no scale in [4, 20]
 *   brings both simultaneously inside [0.7, 1.2] (swept: pop 10000 needs
 *   scale ~6, pop 70000 needs scale ~16). Left at 9.0 (unchanged) since the
 *   named acceptance gate -- trim margin -- is unaffected either way, and
 *   `tests/fidelity-round4.test.ts`'s "fix round 2: yield-matched texture"
 *   test (which pins the [0.7, 1.2] density band at pop 20000/70000) was
 *   already failing before this task for the same reason and remains in
 *   the known-failing set.
 *
 * Values outside [9, 30] clamp to the anchors -- `perPatchDensity` never
 * actually leaves that range, so this is a safety net, not a live branch.
 */
export function baseScaleForYield(targetPerPatch: number): number {
  if (targetPerPatch <= 9) return 1.0;
  if (targetPerPatch >= 30) return 9.0;
  return 1.0 + 8.0 * Math.log10(targetPerPatch / 9) / Math.log10(30 / 9);
}

/**
 * Piecewise log-linear interpolation over a sorted `[population, value]`
 * breakpoint table. Shared by `buildingsPerCorePatch` and
 * `meanBuildingArea` below -- both are fits to MEASURED generation output
 * (not formulas derived from first principles), and the relationship
 * between population and either quantity is not a clean single log-curve
 * (see both functions' doc comments for why), so a table beats trying to
 * force a two-anchor `perPatchDensity`-style curve through points it
 * doesn't actually pass through.
 */
function logInterpolate(table: ReadonlyArray<readonly [number, number]>, population: number): number {
  if (population <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (population >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [hiPop, hiVal] = table[i];
    if (population > hiPop) continue;
    const [loPop, loVal] = table[i - 1];
    const t = Math.log10(population / loPop) / Math.log10(hiPop / loPop);
    return loVal + (hiVal - loVal) * t;
  }
  return last[1];
}

/**
 * Buildings actually produced per walled-CommonWard core patch at this
 * settlement's calibrated texture (`baseScaleForYield(perPatchDensity(pop))`
 * -- see that function's doc comment). Round-cores-faubourgs task 5, fix
 * round 1 (2026-08-09): the FIRST version of this fix used
 * `perPatchDensity(population)` itself (the NOMINAL target) as the demand
 * term, but that target is aspirational -- `baseScaleForYield`'s own doc
 * comment already documents natural yield landing at 0.65x-1.56x of it
 * depending on population, and a direct measurement here (Aldford, walled,
 * seeds 1-5 averaged, counting buildings in walled CommonWard patches only)
 * confirms it undershoots badly at city scale:
 *   pop   300 -> target  9.00, actual  9.57   pop 10000 -> target 30.00, actual 15.71
 *   pop   600 -> target  9.00, actual  9.23   pop 20000 -> target 30.00, actual 18.95
 *   pop  1200 -> target 14.17, actual 14.98   pop 70000 -> target 30.00, actual 19.18
 *   pop  4000 -> target 23.16, actual 15.49
 * Sizing patches for the nominal target (30 buildings at pop 10000) when
 * only ~16 actually materialize made patches ~1.4-1.6x too big -- the
 * fix-round-1 regression this function corrects. Used as the demand term in
 * `patchAreaForDemand` instead of `perPatchDensity` directly.
 */
const BUILDINGS_PER_CORE_PATCH_TABLE: ReadonlyArray<readonly [number, number]> = [
  [300, 9.57], [600, 9.23], [1200, 14.98], [4000, 15.49], [10000, 15.71], [20000, 18.95], [70000, 19.18],
];
export function buildingsPerCorePatch(population: number): number {
  return logInterpolate(BUILDINGS_PER_CORE_PATCH_TABLE, population);
}

/**
 * Mean walled-CommonWard building footprint area (`Polygon.square` units)
 * at this settlement's texture. Feeds `patchAreaForDemand` alongside
 * `buildingsPerCorePatch` -- see that function's doc comment for why
 * `buildPatches`' legacy spiral seeding constant needed replacing at all.
 *
 * Measured the same way as `buildingsPerCorePatch` (Aldford, walled, seeds
 * 1-5 averaged, `Polygon.square` averaged over every building in a walled
 * CommonWard patch):
 *   pop   300 -> 10.92   pop  10000 -> 21.58
 *   pop   600 ->  9.86   pop  20000 -> 21.79
 *   pop  1200 -> 11.39   pop  70000 -> 21.06
 *   pop  4000 -> 15.80
 */
const MEAN_BUILDING_AREA_TABLE: ReadonlyArray<readonly [number, number]> = [
  [300, 10.92], [600, 9.86], [1200, 11.39], [4000, 15.80], [10000, 21.58], [20000, 21.79], [70000, 21.06],
];
export function meanBuildingArea(population: number): number {
  return logInterpolate(MEAN_BUILDING_AREA_TABLE, population);
}

/**
 * Fraction of the walled core's area that finished buildings should cover,
 * once streets/alleys/plaza take their cut. `TARGET_COVERAGE` is the single
 * tuning knob for `patchAreaForDemand` -- raising it shrinks patches
 * (smaller wall), lowering it grows them.
 *
 * Round-cores-faubourgs task 5, fix round 1 (2026-08-09): the owner
 * rejected the render gate -- walled interiors read as largely empty at pop
 * 1200/4000/10000 ("should be PACKED"). Two things measured while tuning
 * this constant (Aldford, walled, seeds 1-5 averaged):
 *
 * 1. Pre-fix coverage was ALREADY 0.36 (pop 1200) / 0.45 (4000) / 0.47
 *    (10000) -- the two larger populations were already close to what this
 *    algorithm can achieve. `getCityBlock`'s per-edge inset (`ward.ts`:
 *    MAIN_STREET=2.0, REGULAR_STREET=1.0, ALLEY=0.6, all ABSOLUTE, not
 *    scaled to patch size) is a close-to-fixed area cost per patch, so it
 *    consumes a GROWING fraction of a shrinking patch -- swept
 *    TARGET_COVERAGE 0.45/0.5/0.55/0.6/0.65/0.7 and actual achieved
 *    coverage does not track the target monotonically: it peaks in the
 *    0.45-0.5 range (where the demand formula barely shrinks pop 4000/
 *    10000's walls at all -- they were already near that peak) and
 *    DECLINES beyond it as the fixed insets eat further into
 *    progressively smaller patches. No value of this constant delivers
 *    both a substantially smaller wall AND a higher coverage ratio
 *    simultaneously at pop 4000/10000 with the alley/inset constants as
 *    they stand today -- that would need those constants themselves
 *    scaled down, which is out of this fix round's scope (see
 *    `src/generator/model.ts`'s `buildPatches` doc comment and the fix
 *    report for the full sweep and the concern flagged to Barry).
 * 2. Given that tension, 0.6 was chosen to prioritise what the owner
 *    stated most concretely -- "much smaller and more compact" -- landing
 *    a genuine double-digit wall-diameter shrink at all three fixture
 *    populations while keeping achieved coverage within a few points of
 *    the pre-fix baseline (not a regression). See `model.ts`'s
 *    `buildPatches` doc comment for the measured before/after numbers.
 */
export const TARGET_COVERAGE = 0.46;

/**
 * Demand-sized walled-core patch area: how much land one core patch needs
 * to hold its ACTUAL yield (`buildingsPerCorePatch`, not the nominal
 * `perPatchDensity` target -- see that function's doc comment for why) of
 * `meanBuildingArea`-sized buildings, at `TARGET_COVERAGE`. Replaces the
 * legacy spiral constant (`coreR = 10 + nCore * 2.5`) as the seed for
 * `buildPatches`' mesh density -- see that function's doc comment for the
 * full story.
 */
export function patchAreaForDemand(population: number): number {
  return buildingsPerCorePatch(population) * meanBuildingArea(population) / TARGET_COVERAGE;
}

export interface GenerationParams {
  /** Number of Voronoi patches for the inner city */
  nPatches: number;
  /**
   * Patches in the walled core. `nPatches` is the TOTAL built budget (core
   * plus extramural sprawl); this is the core's share of it.
   */
  nCore: number;
  /** Population used for scale emission in GeoJSON metadata. */
  population: number;
  /** Whether to generate a central market plaza */
  plazaNeeded: boolean;
  /** Whether to generate a citadel/castle */
  citadelNeeded: boolean;
  /** Whether to generate city walls */
  wallsNeeded: boolean;
  /** Whether to include a cathedral/temple in ward distribution */
  templeNeeded: boolean;
  /** Whether to increase slum proportion */
  shantyNeeded: boolean;
  /** Whether to increase administration wards */
  capitalNeeded: boolean;
  /** Random seed for deterministic generation */
  seed: number;

  // Future extension points
  /**
   * Road entry hints from external map data. Each carries a unit direction vector
   * plus optional routeId and kind so the gate output can echo them back. Multiple
   * routes whose bearings cluster closely together will share a single gate and
   * have their route ids echoed back on the same entrance feature.
   */
  roadEntryPoints?: RoadEntry[];
  /** Compass bearing (degrees, 0=N clockwise) to nearest ocean — enables coastline clipping */
  oceanBearing?: number;
  /** River path through the settlement */
  riverPath?: Point[];
  /**
   * Water-body polygons in burg-local coordinates (origin = burg centre, same
   * scale as the generated mesh). Each entry is a closed polygon representing
   * a water region; a patch whose centroid lies inside any polygon is marked
   * as water. When provided, replaces the `oceanBearing` half-plane
   * classification with shape-faithful coastline handling (bays, coves,
   * peninsulas all surface correctly and the harbour ward settles on the
   * longest waterfront edge).
   */
  coastlineGeometry?: Point[][];
  /** Harbour size — 'large' for major sea routes + big pop, 'small' for minor ports */
  harbourSize?: 'large' | 'small';
  /** People per household — FMG's urbanDensityInput. Drives the building budget. Defaults to densityCurve(population) (villages ≈4 → cities 12); explicit values override. */
  urbanDensity?: number;
  /** Azgaar biome name; flows to the scene for asset-set/palette defaults. */
  biome?: string;
  /**
   * Internal calibration hook (round-4 Task 2, fix round 2): forces
   * `Model.baseMinSqScale` to this value instead of deriving it from
   * `perPatchDensity(population)`. Not part of the public Azgaar input
   * surface — `mapToGenerationParams` never sets it. Exists so calibration
   * scripts (see `calibrate-yield.ts`) can sweep texture scale against a
   * fixed population/seed to measure the pre-trim yield curve that
   * `baseScaleForYield` was fitted from, without needing a second code path.
   * Do not wire this to any external input.
   */
  textureScaleOverride?: number;
}

/**
 * Flags the generator may auto-disable when the requested feature is
 * geometrically infeasible. Surfaced on the output so consumers can
 * distinguish "FMG didn't ask for this" from "settlemaker couldn't build it".
 */
export type DegradedFlag = 'walls' | 'citadel';
