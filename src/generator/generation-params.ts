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
 * Population above which `CommonWard`'s subdivision emits each lot AS the
 * building (watabou-faithful row housing) instead of the inscribed
 * rectangle this port historically substituted -- see `tryEmitBuilding` in
 * `ward.ts` for the mechanism and the measured cost of the old leaf. It is
 * also the population above which every other texture curve here leaves its
 * village value: hamlets keep detached houses with random gaps, which is
 * the look the owner has signed off for a village, while towns and cities
 * get contiguous blocks separated by one alley.
 */
export const ROW_HOUSING_MIN_POPULATION = 600;
/**
 * Population at which the three texture curves (`baseScaleForYield`,
 * `edgeInsetScale`, `targetCoverage`) reach their city values. They ramp
 * together from `ROW_HOUSING_MIN_POPULATION`, because lot grid, lane width
 * and coverage target describe one fabric and a mismatch between them
 * starves it. Fix round 3 (2026-08-10) moved this down from 10000: a
 * row-housed town needs town lane widths, not village ones. It is also the
 * knob that buys margin on `tests/density-target.test.ts`'s unwalled pop
 * 1200 case -- measured over 1200-4000, that case is the most sensitive
 * point on the whole curve.
 */
export const TEXTURE_SATURATION_POPULATION = 2500;
export function rowHousing(population: number): boolean {
  return population > ROW_HOUSING_MIN_POPULATION;
}

/**
 * Ceiling on a single lot's area in a row-housed settlement, as a multiple
 * of `meanBuildingArea`. Ward minSq runs from 10 (slum) to 110
 * (administration/patriciate), and with lots now emitted whole a
 * large-minSq ward could terminate on one lot spanning most of its patch --
 * a single building the size of a block, which breaks the row reading the
 * owner asked for. Above the cap `createAlleys` keeps bisecting, so grand
 * wards still get visibly larger buildings than a slum, just not
 * block-sized ones. Villages are uncapped -- unchanged output.
 */
export const MAX_LOT_AREA_MULTIPLE = 5;
export function maxLotArea(population: number): number {
  return rowHousing(population)
    ? MAX_LOT_AREA_MULTIPLE * meanBuildingArea(population)
    : Infinity;
}

/**
 * Multiplier on `Ward.filterOutskirts`' drop threshold for row-housed
 * settlements -- see that method. Below 1.0 the thinning keeps more of the
 * fabric; villages are pinned at 1.0 (reference behaviour, unchanged).
 */
export const ROW_OUTSKIRTS_BITE = 0.4;

/**
 * Floor for `edgeInsetScale` -- see that function for how it was chosen.
 */
export const EDGE_INSET_FLOOR = 0.6;

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
 * `perPatchDensity` target -- i.e. how coarse the lot grid is, hence how
 * big a finished building is.
 *
 * Round-cores-faubourgs task 5, fix round 3 (2026-08-10). Rounds 1-2 fitted
 * this anchor UPWARD (to 9.0 at city texture) to stop `applyBuildingBudget`
 * trimming a huge natural over-yield. That worked, but it bought the low
 * trim rate with enormous buildings: measured mean footprint 19-23 area
 * units in a city core against 7-8 in a village, i.e. a "house" three times
 * a villager's, and only ~16-19 of them per patch against a nominal target
 * of 30. Two owner-visible consequences followed. The census landed at
 * 49-56% of households at pop 4000-10000 (the floor test's 60% bar was
 * being scraped, not cleared), and -- because a settlement's total core
 * area is `budget * meanBuildingArea / coverage` -- oversized buildings put
 * a hard floor under the wall radius no coverage target could lift.
 *
 * The fix inverts the anchor: city texture is now FINER than village
 * texture, not coarser. Lots come out house-sized (measured mean 7.7-9.0
 * area at every population above the village band, against a village's
 * 7.4-8.2), which is what lets the same census fit inside a ~27% tighter
 * wall. Natural yield per patch now lands ON `perPatchDensity`'s target
 * (measured 13.9/21.7/30.5 at pop 1200/4000/10000 against targets of
 * 14.2/23.2/30.0), so the trim barely engages -- the property rounds 1-2
 * were buying, obtained the other way round.
 *
 * Anchors, log-interpolated:
 * - (9, 1.0): villages, hard-pinned. pop <= 600 output must stay
 *   byte-stable (verified: pop 300 SVG is md5-identical before and after
 *   this fix round).
 * - (`CITY_TEXTURE_TARGET`, `CITY_TEXTURE_SCALE`): city texture, reached at
 *   `perPatchDensity(TEXTURE_SATURATION_POPULATION)` so that all three
 *   texture curves (this, `edgeInsetScale`, `targetCoverage`) saturate at
 *   the same population.
 *
 * Fix round 4 (2026-08-10) added the ROW-ONSET RAMP. `fillLots` switches on
 * as a step at `ROW_HOUSING_MIN_POPULATION`, and a whole lot is ~1.6x the
 * inscribed rectangle it replaced, so at pop 601 the curve above (still ~1.0
 * there, a village texture) produced buildings ~44% LARGER than a pop-600
 * village's -- measured mean ordinary building area 7.53 at pop 600 against
 * 10.85 at pop 601 (unwalled, seeds 1-3). That is the very inversion fix
 * round 3 set out to remove, relocated to the band bottom. The ramp cancels
 * the leaf-policy step at the boundary and unwinds itself by
 * `ROW_ONSET_BLEND_POPULATION`, so this curve returns fix round 3's exact
 * value at and above pop 1200 (measured: pop 1200/20000/50000 output is
 * byte-identical with only this change applied) and villages are untouched.
 * Measured after the ramp, mean ordinary building area (unwalled, seeds
 * 1-3): 7.53 at pop 600, 7.91 at 601, 8.20/8.57/8.07 at 625/650/700 -- the
 * largest step across the boundary is +5%, against +44% before.
 */
export const CITY_TEXTURE_SCALE = 0.6;
export const CITY_TEXTURE_TARGET = 14.9;
/**
 * Multiplier applied to the city-texture curve immediately above
 * `ROW_HOUSING_MIN_POPULATION`, unwinding linearly (in log yield) to 1.0 at
 * `ROW_ONSET_BLEND_POPULATION`. Fitted so the mean building area at pop 601
 * matches pop 600's: whole lots carry ~1.44x the area the rectangle leaf
 * kept at the same grid, so the grid has to come in by the reciprocal.
 */
export const ROW_ONSET_TEXTURE_FACTOR = 0.60;
/**
 * Population at which the row-onset ramp is fully unwound. Chosen as the
 * lowest population any pinned calibration anchor or test sits on (the
 * `meanBuildingArea`/`density-target` pop-1200 case), so everything from
 * there upward keeps fix round 3's shipped numbers exactly.
 */
export const ROW_ONSET_BLEND_POPULATION = 1200;
const ROW_ONSET_BLEND_TARGET = perPatchDensity(ROW_ONSET_BLEND_POPULATION);
export function baseScaleForYield(targetPerPatch: number): number {
  if (targetPerPatch <= 9) return 1.0;
  const city = targetPerPatch >= CITY_TEXTURE_TARGET
    ? CITY_TEXTURE_SCALE
    : 1.0 + (CITY_TEXTURE_SCALE - 1.0) *
      Math.log10(targetPerPatch / 9) / Math.log10(CITY_TEXTURE_TARGET / 9);
  if (targetPerPatch >= ROW_ONSET_BLEND_TARGET) return city;
  const u = Math.log10(targetPerPatch / 9) / Math.log10(ROW_ONSET_BLEND_TARGET / 9);
  return city * (ROW_ONSET_TEXTURE_FACTOR + (1 - ROW_ONSET_TEXTURE_FACTOR) * u);
}

/**
 * Absolute floor on the texture scale `Model.refineDensity`'s densify pass
 * may drive the fabric to (see `densifyGroup`). The floor exists to stop
 * that pass shrinking buildings into invisibility, so it is set from a
 * LEGIBILITY bound, measured directly against the render's own dimensions:
 * an ordinary building has to stay wider than the 0.6-unit alley beside it
 * and the 0.15-unit stroke drawn around it. Measured mean core building
 * area at pop 10000 (seeds 1-3), sweeping `textureScaleOverride`:
 *
 *   scale 0.15 -> 2.18 (1.5 per side, at/below alley width; the "slivers"
 *                       fix round 3 saw and reacted to)
 *   scale 0.25 -> 3.44 (1.9 per side)
 *   scale 0.30 -> 4.25 (2.1 per side, ~3.5x alley width)
 *   scale 0.60 -> 7.98 (2.8 per side)
 *
 * 0.30 -- half the city texture -- is the lowest scale still comfortably
 * above the bound, so it is the floor. Fix round 3 set the floor at
 * `CITY_TEXTURE_SCALE` itself, which equals `baseMinSqScale` at every
 * population above ~1350: the densify pass had exactly zero headroom there
 * and could never answer a yield shortfall, which is why the census landed
 * at 85-94% instead of ~100%.
 */
export const DENSIFY_MIN_TEXTURE_SCALE = 0.30;

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
 * Buildings one walled-core patch is sized to hold -- the demand term in
 * `patchAreaForDemand`.
 *
 * Rounds 1-2 read this from a table of MEASURED yields, because natural
 * yield undershot the nominal `perPatchDensity` target by up to 2x and
 * sizing patches for a target they never hit inflated them. That table also
 * fed back on itself (measure yield -> resize patches -> yield changes) and
 * had a documented blind spot: it was calibrated on an always-walled
 * fixture while the populations it covers include unwalled builds.
 *
 * Fix round 3 (2026-08-10) retires both problems at once. With house-sized
 * lots (see `baseScaleForYield`) natural yield now lands on the nominal
 * target -- measured 13.9/21.7/30.5 per patch at pop 1200/4000/10000
 * against targets of 14.2/23.2/30.0 -- so the honest demand term IS the
 * target, which is also the number `nCore` itself was derived from. No
 * feedback loop, no fixture blind spot, one fewer calibration table.
 *
 * Villages keep their measured anchors: their patch area must not move
 * (byte-stability), and below the row-housing threshold the leaf policy is
 * the old inscribed-rectangle one, whose yield genuinely differs from the
 * target.
 */
const VILLAGE_YIELD_TABLE: ReadonlyArray<readonly [number, number]> = [
  [300, 9.57], [600, 9.23],
];
export function buildingsPerCorePatch(population: number): number {
  if (!rowHousing(population)) return logInterpolate(VILLAGE_YIELD_TABLE, population);
  return perPatchDensity(population);
}

/**
 * Mean walled-CommonWard building footprint area (`Polygon.square` units)
 * at this settlement's texture. The other half of `patchAreaForDemand`, and
 * -- since core area is `budget * meanBuildingArea / coverage` -- the term
 * that actually governs how big the wall has to be for a given census.
 *
 * Measured against the Aldford walled fixture, seeds 1-5 averaged,
 * `Polygon.square` averaged over every building in a walled CommonWard
 * patch, and iterated to a fixed point (the measurement moves the patch
 * area, which moves the measurement) -- fix round 3 (2026-08-10), after the
 * row-housing leaf and the re-anchored texture scale:
 *   pop   300 -> 10.92 (village, unchanged)  pop 10000 -> 9.03 (was 21.63)
 *   pop   600 ->  9.86 (village, unchanged)  pop 20000 -> 8.17 (was 21.52)
 *   pop  1200 ->  7.67 (was 11.39)           pop 70000 -> 8.17 (was 21.28)
 *   pop  4000 ->  8.59 (was 16.87)
 *
 * The 20000 and 70000 anchors are deliberately EQUAL. Both populations are
 * cap-bound (`MAX_PATCHES`), so `tests/fidelity-round4.test.ts` pins their
 * walled radius as non-increasing; a 0.4% difference between two
 * measurements inside seed noise was enough to break that contract by
 * 0.1%. Tying them makes the cap-bound tail exactly flat, which is what the
 * contract says it is.
 */
const MEAN_BUILDING_AREA_TABLE: ReadonlyArray<readonly [number, number]> = [
  [300, 10.92], [600, 9.86], [1200, 7.67], [4000, 8.59], [10000, 9.03], [20000, 8.17], [70000, 8.17],
];
export function meanBuildingArea(population: number): number {
  return logInterpolate(MEAN_BUILDING_AREA_TABLE, population);
}

/**
 * Fraction of the walled core's area that finished buildings should cover,
 * once streets/alleys/plaza take their cut -- the divisor in
 * `patchAreaForDemand`: raising it shrinks patches (smaller wall), lowering
 * it grows them. It is only useful up to what the fabric can actually
 * achieve; past that, patches shrink faster than they fill and the census
 * falls.
 *
 * Rounds 1-2 could not push this past 0.55 without breaking
 * `tests/density-target.test.ts`'s floor, because the leaf policy threw
 * away 38% of every lot's area to an inscribed rectangle and dropped 11% of
 * lots outright (see `tryEmitBuilding` in `ward.ts`). With lots emitted
 * whole, the achievable coverage rose with it: measured 0.578/0.695/0.689
 * at pop 1200/4000/10000, against 0.433/0.507/0.523 before.
 *
 * `CITY_TARGET_COVERAGE = 0.72` is set slightly above the achieved figure
 * on purpose -- it is a demand divisor, not a prediction, and the gap is
 * what keeps the wall closing in. Verified against the hard floor at its
 * real call sites: pop 1200 (unwalled path) 131 against a 121 floor, pop
 * 4500 (walled) 513 against 307.
 *
 * Villages (population <= `ROW_HOUSING_MIN_POPULATION`) stay pinned at
 * `VILLAGE_TARGET_COVERAGE` -- their leaf policy, insets and patch area are
 * all unchanged, and raising their coverage target shrank their patches
 * below what curtain-wall fitting can survive (measured in fix round 2: pop
 * 300/600 lost whole seeds). Between the two, the target ramps to the city
 * value by `TEXTURE_SATURATION_POPULATION`, in step with `edgeInsetScale`
 * and `baseScaleForYield` -- the three have to move together, because a
 * coverage target the insets cannot afford just starves the fabric.
 */
export const VILLAGE_TARGET_COVERAGE = 0.46;
export const CITY_TARGET_COVERAGE = 0.72;
export function targetCoverage(population: number): number {
  if (population <= ROW_HOUSING_MIN_POPULATION) return VILLAGE_TARGET_COVERAGE;
  const t = Math.min(1, Math.log10(population / ROW_HOUSING_MIN_POPULATION) /
    Math.log10(TEXTURE_SATURATION_POPULATION / ROW_HOUSING_MIN_POPULATION));
  return VILLAGE_TARGET_COVERAGE + (CITY_TARGET_COVERAGE - VILLAGE_TARGET_COVERAGE) * t;
}

/**
 * Demand-sized walled-core patch area: how much land one core patch needs
 * to hold `buildingsPerCorePatch` buildings of `meanBuildingArea` each, at
 * `targetCoverage(population)`. Replaces the legacy spiral constant
 * (`coreR = 10 + nCore * 2.5`) as the seed for `buildPatches`' mesh
 * density -- see that function's doc comment for the full story.
 *
 * Note what this implies for the wall: total core area is roughly
 * `buildingBudget * meanBuildingArea / targetCoverage`, so with the census
 * fixed, house size and coverage are the ONLY two levers on wall radius.
 * That is why fix round 3 shrank the houses.
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
 * Those insets are fixed absolute widths, so as `patchAreaForDemand`
 * shrinks patches the insets would otherwise eat a GROWING share of a
 * shrinking patch -- capping achievable coverage regardless of
 * `targetCoverage`. Scaling them down alongside the fabric keeps the cost
 * per edge at roughly the same FRACTION instead of a growing one.
 *
 * Driver: population, not raw patch size -- `patchAreaForDemand` is not
 * monotonic in population in a way that is safe to invert, and population
 * is the knob the owner's ask is stated in terms of.
 *
 * Villages (population <= `ROW_HOUSING_MIN_POPULATION`) keep today's widths
 * untouched -- scale 1.0, byte-stability plus the airy-hamlet look. Above
 * that, scale falls log-linearly to `EDGE_INSET_FLOOR` by
 * `TEXTURE_SATURATION_POPULATION`. Fix round 3 (2026-08-10) moved that
 * saturation point down from 10000: the whole point of the three texture
 * curves is that a settlement's lot grid, street widths and coverage target
 * describe ONE fabric, and a town at pop 1200-2500 that has already
 * switched to row housing needs the matching lane widths, not village ones.
 *
 * `EDGE_INSET_FLOOR` is chosen against the documented legibility floor:
 * `NORMAL_STROKE` is 0.15, and a repo gotcha flags a 0.6-unit (unscaled)
 * alley as near the visibility edge, so lanes must not drop below ~0.35
 * units. At the floor, `ALLEY` (0.6) scales to 0.36; `REGULAR_STREET` and
 * `MAIN_STREET` scale to 0.6 and 1.2. Verified by direct inspection of
 * 1800x1800 rasters at pop 4000/10000 -- every lane between rows is
 * visible, no merged or muddy blocks.
 */
export function edgeInsetScale(population: number): number {
  if (population <= ROW_HOUSING_MIN_POPULATION) return 1.0;
  const raw = 1.0 - (1.0 - EDGE_INSET_FLOOR) *
    Math.log10(population / ROW_HOUSING_MIN_POPULATION) /
    Math.log10(TEXTURE_SATURATION_POPULATION / ROW_HOUSING_MIN_POPULATION);
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
