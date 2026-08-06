import { Point } from '../types/point.js';

/** Narrative/transport category of an approaching route. */
export type RouteKind = 'road' | 'foot' | 'sea';

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
 * cities pack ~30 tight blocks per patch (the watabou city look),
 * log-scaled between pop 1 000 and 20 000. Drives BOTH the patch count
 * (footprint) and the default block size (texture) so they stay coherent.
 */
export function perPatchDensity(population: number): number {
  if (population <= 1000) return 9;
  return Math.min(30, 9 + 21 * Math.log10(population / 1000) / Math.log10(20));
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
 *   pop <= 1000 output must stay byte-stable (existing pinned-hash tests).
 * - (30, 9.0): the largest scale, measured against a fixed Aldford (seed 9,
 *   walled) fixture at BOTH pop 20000 and pop 70000 (`calibrate-yield.ts`),
 *   that keeps pre-trim yield within a <12%-trim margin of target at both
 *   populations simultaneously -- their patches differ in average area by
 *   ~2.9x (bigger cities get bigger patches, not just more of them), so a
 *   single scale can't perfectly match both, but 9.0 keeps trim at 0% (pop
 *   20000) and 3.3% (pop 70000), both comfortably under the 12% ceiling,
 *   with post-trim density landing at 0.76x/0.94x target respectively (both
 *   inside the accepted [0.7, 1.2]x band). See task-2-report.md's
 *   "Fix round 2" section for the full measured curve.
 *
 * Values outside [9, 30] clamp to the anchors -- `perPatchDensity` never
 * actually leaves that range, so this is a safety net, not a live branch.
 */
export function baseScaleForYield(targetPerPatch: number): number {
  if (targetPerPatch <= 9) return 1.0;
  if (targetPerPatch >= 30) return 9.0;
  return 1.0 + 8.0 * Math.log10(targetPerPatch / 9) / Math.log10(30 / 9);
}

export interface GenerationParams {
  /** Number of Voronoi patches for the inner city */
  nPatches: number;
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
