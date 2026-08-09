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
 * confirmed it undershoots badly at city scale.
 *
 * Fix round 2 (2026-08-09): re-measured the SAME fixture after
 * `edgeInsetScale` scaled `ward.ts`'s per-edge insets down -- narrower
 * streets/alleys leave more area for buildings, so natural yield at a given
 * population changes:
 *   pop   300 ->  9.57 (unchanged, insetScale=1.0 below pop 600)
 *   pop   600 ->  9.23 (unchanged, insetScale=1.0 below pop 600)
 *   pop  1200 -> 14.98 (measured 14.75 -- LEFT AT THE OLD VALUE, see below)
 *   pop  4000 -> 16.25 (was 15.49)
 *   pop 10000 -> 18.37 (was 15.71)
 *   pop 20000 -> 23.51 (was 18.95)
 *   pop 70000 -> 23.05 (was 19.18)
 *
 * pop 1200's anchor is a deliberate exception: `tests/density-target.test.ts`
 * exercises pop 1200 through its REAL (unwalled -- population < 2000)
 * `walls:false` path, and that path turned out to sit on a razor's edge --
 * swapping in the freshly-measured 14.75 (barely 1.5% below the old 14.98)
 * alone, with `targetCoverage` still flat at 0.46, was enough to drop the
 * unwalled pop-1200 build from 121+ ordinary buildings to 100, failing the
 * hard 60%-of-budget floor. The walled-Aldford fixture this table is
 * calibrated against doesn't exercise that path at all, so it can't see the
 * fragility -- re-measuring blind and trusting the walled number would have
 * shipped a regression the calibration fixture is structurally unable to
 * catch. Pinning pop 1200 at its pre-fix-round-2 value sidesteps that cliff
 * entirely (the two numbers are nearly identical anyway) while still
 * re-measuring every anchor where the fixture and the real test path agree.
 * Used as the demand term in `patchAreaForDemand` instead of
 * `perPatchDensity` directly.
 */
const BUILDINGS_PER_CORE_PATCH_TABLE: ReadonlyArray<readonly [number, number]> = [
  [300, 9.57], [600, 9.23], [1200, 14.98], [4000, 16.25], [10000, 18.37], [20000, 23.51], [70000, 23.05],
];
export function buildingsPerCorePatch(population: number): number {
  return logInterpolate(BUILDINGS_PER_CORE_PATCH_TABLE, population);
}

/**
 * Mean walled-CommonWard building footprint area (`Polygon.square` units)
 * at this settlement's texture. Feeds `patchAreaForDemand` alongside
 * `buildingsPerCorePatch` -- see that function's doc comment for why
 * `buildPatches`' legacy spiral seeding constant needed replacing at all,
 * and for why pop 1200 is pinned at its pre-fix-round-2 value.
 *
 * Measured the same way as `buildingsPerCorePatch` (Aldford, walled, seeds
 * 1-5 averaged, `Polygon.square` averaged over every building in a walled
 * CommonWard patch), fix round 2 (2026-08-09), after `edgeInsetScale`:
 *   pop   300 -> 10.92 (unchanged)   pop 10000 -> 21.63 (was 21.58)
 *   pop   600 ->  9.86 (unchanged)   pop 20000 -> 21.52 (was 21.79)
 *   pop  1200 -> 11.39 (pinned)      pop 70000 -> 21.28 (was 21.06)
 *   pop  4000 -> 16.87 (was 15.80)
 */
const MEAN_BUILDING_AREA_TABLE: ReadonlyArray<readonly [number, number]> = [
  [300, 10.92], [600, 9.86], [1200, 11.39], [4000, 16.87], [10000, 21.63], [20000, 21.52], [70000, 21.28],
];
export function meanBuildingArea(population: number): number {
  return logInterpolate(MEAN_BUILDING_AREA_TABLE, population);
}

/**
 * Fraction of the walled core's area that finished buildings should cover,
 * once streets/alleys/plaza take their cut -- `targetCoverage`'s return
 * value is the tuning knob for `patchAreaForDemand`: raising it shrinks
 * patches (smaller wall), lowering it grows them.
 *
 * Round-cores-faubourgs task 5, fix round 1 (2026-08-09): the owner
 * rejected the render gate -- walled interiors read as largely empty at pop
 * 1200/4000/10000 ("should be PACKED"). Fix round 1 found a hard ceiling: a
 * SINGLE global coverage target (then 0.46) couldn't rise further without
 * breaking `density-target.test.ts`'s pop 1200/4500 floor, because
 * `getCityBlock`'s per-edge inset (`ward.ts`: MAIN_STREET/REGULAR_STREET/
 * ALLEY) was a fixed absolute cost per patch edge that ate a GROWING share
 * of a shrinking patch -- no coverage target delivered both a smaller wall
 * AND higher coverage at pop 4000/10000 simultaneously.
 *
 * Fix round 2 (2026-08-09), owner decision: SCALE THE INSETS instead (see
 * `edgeInsetScale`) -- the per-edge cost now shrinks roughly in step with
 * the patch, so raising the coverage target past the old 0.46 ceiling
 * actually works now.
 *
 * BUT: `targetCoverage` is a single global divisor in `patchAreaForDemand`,
 * applied at every population -- raising it uniformly also shrinks village
 * (pop <= 600) patches, even though `edgeInsetScale` leaves their insets
 * untouched. That silently changed the airy-hamlet look and broke
 * generation outright at the small end (measured: pop 300/600 lost whole
 * seeds to wall-fitting failures once their patches got small enough).
 * `targetCoverage` is therefore pinned flat at `VILLAGE_TARGET_COVERAGE`
 * (0.46, the historical fix-round-1 value -- keeps pop <= 600 byte-
 * identical to before this fix round) and rises log-linearly to
 * `CITY_TARGET_COVERAGE` by `DEFAULT_CORE_CAPACITY` (pop 10000), mirroring
 * `perPatchDensity`'s and `edgeInsetScale`'s own saturation points.
 *
 * `CITY_TARGET_COVERAGE = 0.55` -- bisected against
 * `tests/density-target.test.ts`'s pop 1200/4500 floor (both exercised
 * through their REAL `walls:false`/`walls:true` paths, not the Aldford
 * calibration fixture) with `BUILDINGS_PER_CORE_PATCH_TABLE` /
 * `MEAN_BUILDING_AREA_TABLE` at their fix-round-2 values: 0.61 is the
 * highest value where both cases still pass at all, but 0.60/0.61 land pop
 * 1200 almost exactly AT the floor (121/121 at 0.60 -- zero headroom against
 * seed variance in this single-seed test), and 0.62 already drops pop 4500
 * to 291/307 (fails). That is a SHARP cliff, not a gradual slope -- 0.60 to
 * 0.65 swings pop 1200 from just-passing to 106/121. 0.55 was chosen instead
 * of the higher edge-of-cliff values to keep real margin (pop 1200 lands at
 * 145/121, pop 4500 at 323/307) rather than shipping a config that passes
 * today's fixed-seed test by a single building.
 *
 * This raises the ceiling only modestly past fix round 1's 0.46 -- far
 * short of the 0.8-1.0 range that would be needed to hit "much smaller and
 * more compact" outright (swept and rejected: those values fail pop
 * 1200/4500 by 20-45%). The reason isn't the insets anymore -- it's
 * `createAlleys`' well-known super-linear yield-vs-area relationship
 * (`baseScaleForYield`'s doc comment) interacting with `minSqScale`, which
 * is fixed PER POPULATION (via `perPatchDensity`), not per patch area: as
 * `targetCoverage` shrinks a patch below a few multiples of its `minSq`
 * threshold, `createAlleys` terminates earlier and yields disproportionately
 * FEWER buildings, not just proportionately fewer -- so pushing coverage
 * higher can shrink total city-wide building count faster than it shrinks
 * wall radius, and the hard population-scaled floor catches that before the
 * wall visibly shrinks much. See the fix-round-2 report for the measured
 * before/after wall-radius table and this concern, flagged for Barry.
 */
export const VILLAGE_TARGET_COVERAGE = 0.46;
export const CITY_TARGET_COVERAGE = 0.55;
export function targetCoverage(population: number): number {
  if (population <= 600) return VILLAGE_TARGET_COVERAGE;
  const t = Math.min(1, Math.log10(population / 600) / Math.log10(10000 / 600));
  return VILLAGE_TARGET_COVERAGE + (CITY_TARGET_COVERAGE - VILLAGE_TARGET_COVERAGE) * t;
}

/**
 * Demand-sized walled-core patch area: how much land one core patch needs
 * to hold its ACTUAL yield (`buildingsPerCorePatch`, not the nominal
 * `perPatchDensity` target -- see that function's doc comment for why) of
 * `meanBuildingArea`-sized buildings, at `targetCoverage(population)`.
 * Replaces the legacy spiral constant (`coreR = 10 + nCore * 2.5`) as the
 * seed for `buildPatches`' mesh density -- see that function's doc comment
 * for the full story.
 */
export function patchAreaForDemand(population: number): number {
  return buildingsPerCorePatch(population) * meanBuildingArea(population) / targetCoverage(population);
}

/**
 * Multiplier on `ward.ts`'s `MAIN_STREET`/`REGULAR_STREET`/`ALLEY` -- both
 * `Ward.getCityBlock`'s per-edge patch inset AND `createAlleys`'s
 * building-to-building alley gap (`CommonWard` threads this through both
 * call sites so a "street" reads as the same width whichever geometry it
 * bounds). Round-cores-faubourgs task 5, fix round 2 (2026-08-09), owner
 * decision: SCALE THE INSETS.
 *
 * Fix round 1 found a structural ceiling: those insets are fixed absolute
 * widths, so as `patchAreaForDemand` shrinks patches at city populations
 * (raising the coverage target, then a single flat `TARGET_COVERAGE`), the
 * insets eat a GROWING share of a shrinking patch -- no target coverage
 * could deliver both a smaller wall
 * AND a higher coverage ratio at pop 4000/10000 (see `patchAreaForDemand`'s
 * doc comment, historical version, for the swept evidence). Scaling the
 * insets down alongside the fabric removes that ceiling: the ABSOLUTE cost
 * per edge shrinks with the patch, so it keeps eating roughly the same
 * FRACTION instead of a growing one.
 *
 * Driver: population, not raw patch size -- `patchAreaForDemand` itself
 * isn't monotonic in population in a way that's safe to invert (a bigger
 * settlement's patches hold more AND bigger buildings, so demand area
 * actually grows with population even as the walls got tighter), so tying
 * inset width to "current patch size vs. village patch size" doesn't track
 * "how packed does this settlement's fabric look." Population is the
 * direct, monotonic knob the owner's ask ("much smaller and more compact"
 * at increasing pop) is stated in terms of.
 *
 * Villages (population <= 600) keep TODAY's widths untouched -- scale 1.0,
 * pinned-hash byte-stability tests + the airy-hamlet look must not change.
 * Above 600, scale falls log-linearly to `EDGE_INSET_FLOOR` by
 * `DEFAULT_CORE_CAPACITY` (10000), matching `perPatchDensity`'s own
 * saturation point.
 *
 * `EDGE_INSET_FLOOR` is chosen against the documented legibility floor:
 * `NORMAL_STROKE` is 0.15, and a repo gotcha already flags that a 0.6-unit
 * (unscaled) alley is near the visibility edge, so lanes must not drop
 * below ~0.35 units. At the floor, `ALLEY` (0.6) scales to 0.6 * 0.6 = 0.36
 * -- comfortably clears 0.35 with room for seed variance; `REGULAR_STREET`
 * (1.0) and `MAIN_STREET` (2.0) scale to 0.6 and 1.2, both well clear.
 * Verified by direct visual inspection of rendered SVGs (not just the
 * arithmetic) at pop 1200/4000/10000 -- no muddy or invisible lanes; see
 * the fix-round-2 report.
 */
export const EDGE_INSET_FLOOR = 0.6;
export function edgeInsetScale(population: number): number {
  if (population <= 600) return 1.0;
  const raw = 1.0 - (1.0 - EDGE_INSET_FLOOR) *
    Math.log10(population / 600) / Math.log10(10000 / 600);
  return Math.max(EDGE_INSET_FLOOR, raw);
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
