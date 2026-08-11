import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { Segment } from '../geom/segment.js';
import { Voronoi } from '../geom/voronoi.js';
import { SeededRandom } from '../utils/random.js';
import { sign } from '../utils/math-utils.js';
import { minBy, maxBy, randomElement, last } from '../utils/array-utils.js';

import { Patch } from './patch.js';
import { CurtainWall } from './curtain-wall.js';
import { Topology } from './topology.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import type { GenerationParams, DegradedFlag } from './generation-params.js';
import { densityCurve, perPatchDensity, baseScaleForYield, patchAreaForDemand, rowHousing, DENSIFY_MIN_TEXTURE_SCALE } from './generation-params.js';
import { WardType } from '../types/interfaces.js';
import type { Street } from '../types/interfaces.js';

import { buildAdjacency, type PatchAdjacency } from './adjacency.js';
import { assignSprawl } from './zoning.js';
import type { UrbanisationField } from './urbanisation.js';
import { routeWeights } from './route-weight.js';
import { MAX_PATCHES } from '../input/azgaar-input.js';

import { Ward } from '../wards/ward.js';
import { GateWard } from '../wards/gate-ward.js';
import { Market } from '../wards/market.js';
import { Castle } from '../wards/castle.js';
import { Farm } from '../wards/farm.js';
import { Slum } from '../wards/slum.js';
import { Harbour } from '../wards/harbour.js';
import { CommonWard } from '../wards/common-ward.js';
import { CraftsmenWard } from '../wards/craftsmen-ward.js';
import { buildWardDistribution, type WardConstructor } from '../wards/ward-distribution.js';

const MAX_ATTEMPTS = 20;
/**
 * `optimizeJunctions`' vertex-merge distance as a fraction of the mesh cell
 * size, for row-housed settlements — see that method's doc comment.
 */
const JUNCTION_MERGE_FRACTION = 0.30;
const MIN_POPULATION_FOR_WALLS = 150;

/** Golden angle: consecutive seed points never align into spokes. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Ward types whose buildings are feature landmarks, exempt from the population budget. */
const BUDGET_EXEMPT_WARD_TYPES = new Set<WardType>([
  WardType.Castle,
  WardType.Cathedral,
  WardType.Market,
  WardType.Harbour,
]);

/** Ordinary buildings — those the population budget applies to. */
function isBudgetedWard(ward: Ward): boolean {
  return ward.type !== WardType.Park && !BUDGET_EXEMPT_WARD_TYPES.has(ward.type);
}

/**
 * Above this budget (and for any walled settlement, regardless of budget),
 * applyBuildingBudget switches from the hamlet's global nearest-centre trim
 * to the proportional per-patch policy — see applyBuildingBudget doc comment.
 */
const HAMLET_TRIM_MAX_BUDGET = 40;

/**
 * Population-derived cap on ordinary buildings: ≈ one household per
 * `urbanDensity` people (FMG's urbanDensityInput; default follows
 * `densityCurve`), floored at 2 so even a pop-1 burg reads as a settlement.
 */
export function buildingBudget(population: number, urbanDensity?: number): number {
  const d = urbanDensity ?? densityCurve(population);
  return Math.max(2, Math.round(population / d));
}

/**
 * A pier whose every vertex is in water is detached from the visible shore.
 * Slide it along its long axis toward land in small steps until its base
 * makes landfall (tip stays wet — we stop at the first dry vertex). Returns
 * null when no landfall exists within ~3 pier-lengths: a true detached raft.
 * Deterministic; no rng.
 */
function rescueDetachedPier(pier: Polygon, inWater: (p: Point) => boolean): Polygon | null {
  if (pier.vertices.some(v => !inWater(v))) return pier;

  let dx = 0, dy = 0, longest = -1;
  pier.forEdge((a, b) => {
    const len = Point.distance(a, b);
    if (len > longest) {
      longest = len;
      dx = (b.x - a.x) / len;
      dy = (b.y - a.y) / len;
    }
  });
  if (longest <= 0) return null;

  const step = longest / 4;
  for (let k = 1; k <= 12; k++) {
    for (const dir of [1, -1]) {
      const ox = dir * dx * step * k;
      const oy = dir * dy * step * k;
      const moved = pier.vertices.map(v => new Point(v.x + ox, v.y + oy));
      if (moved.some(v => !inWater(v))) {
        return new Polygon(moved);
      }
    }
  }
  return null;
}

export class Model {
  rng: SeededRandom;

  private nPatches: number;
  private nCore: number;
  private plazaNeeded: boolean;
  private citadelNeeded: boolean;
  private wallsNeeded: boolean;
  readonly params: GenerationParams;

  /** Built once per buildPatches pass, rebuilt at the start of createWards. */
  adjacency: PatchAdjacency | null = null;
  /** The field zoning used to place sprawl. Null before createWards runs. */
  urbanisationField: UrbanisationField | null = null;

  topology: Topology | null = null;
  patches: Patch[] = [];
  waterbody: Patch[] = [];
  inner: Patch[] = [];
  citadel: Patch | null = null;
  plaza: Patch | null = null;
  harbour: Patch | null = null;
  center: Point = new Point();

  border: CurtainWall | null = null;
  wall: CurtainWall | null = null;

  cityRadius: number = 0;

  /** Adjacency-hop depth of the farm belt; scales with population. */
  farmRingDepth: number = 1;
  gates: Point[] = [];
  readonly degradedFlags: Set<DegradedFlag> = new Set();

  /**
   * Half-plane coastline synthesized from `oceanBearing` when no vector
   * coastline was supplied, so bearing-only burgs share the geometry water
   * pipeline (render, drowning filter, road clipping) instead of the old
   * enclosed-lake patch painting. Null when a real coastline exists or the
   * burg is landlocked.
   */
  syntheticCoast: Point[][] | null = null;

  /**
   * Multiplier applied to CommonWard minSq during geometry builds. Set by
   * refineDensity's second pass to shrink block size when the first build
   * lands far below the household target; restored to `baseMinSqScale`
   * otherwise (village-unchanged 1.0 up to city-packed 9.0, from
   * `baseScaleForYield(perPatchDensity(population))` -- see that function's
   * doc comment for why bigger cities need a LARGER minSq scale, not
   * smaller, to hit their per-patch building target).
   */
  minSqScale: number;

  /**
   * Base texture scale for this settlement's population, derived once in
   * the constructor from `baseScaleForYield(perPatchDensity(population))`:
   * 1.0 for villages (unchanged, byte-stable) up to 9.0 for the densest
   * cities (fitted from calibration so natural yield lands near the target
   * instead of miles above it — see `baseScaleForYield`'s doc comment).
   * `minSqScale` always returns to this value outside of `refineDensity`'s
   * corrective pass.
   */
  private readonly baseMinSqScale: number;

  /**
   * Target mesh cell edge (`sqrt(patchAreaForDemand)`) for this settlement,
   * set by `buildPatches`. Read by `optimizeJunctions` so its merge
   * threshold scales with the fabric instead of being a flat constant.
   */
  private cellSize = 0;

  /**
   * Ordinary-building count immediately before `applyBuildingBudget`'s trim
   * (after `refineDensity` and the drowning filter, so it reflects the
   * actual natural yield of this generation, not a theoretical estimate).
   * Internal/cheap — set once per `buildGeometry()` call — kept public so
   * calibration scripts and tests can read the pre-trim/post-trim ratio
   * without a second code path. 0 before geometry has been built.
   */
  pretrimOrdinaryCount = 0;

  /**
   * `pretrimOrdinaryCount`'s walled-core-only counterpart: for a sprawling
   * settlement (suburb/satellite patches present), sprawl and the much
   * larger radius*12 farm ring both count toward `pretrimOrdinaryCount` but
   * aren't what `applyBuildingBudget`'s core/other split (or its trim
   * fraction) is about — this isolates the core's own pre-trim/post-trim
   * ratio. Equal to `pretrimOrdinaryCount` when there's no sprawl.
   */
  pretrimCoreOrdinaryCount = 0;

  arteries: Street[] = [];
  streets: Street[] = [];
  roads: Street[] = [];
  /**
   * Plaza-perimeter segments built by `buildStreets` to join every approach's
   * distinct plaza-vertex endpoint into one ring — spec §7: "the roads will
   * always actually join." `tidyUpRoads`'s ordinary plaza-skip filter (which
   * drops segments wholly inside the plaza, since a ward's own frontage
   * shouldn't double as a street) exempts members of this set.
   */
  private plazaRingSegments: Set<Street> = new Set();

  constructor(params: GenerationParams) {
    this.params = params;
    this.rng = new SeededRandom(params.seed);
    this.nPatches = params.nPatches;
    this.nCore = Math.min(params.nCore, params.nPatches);
    this.plazaNeeded = params.plazaNeeded;
    this.citadelNeeded = params.citadelNeeded;
    this.wallsNeeded = params.wallsNeeded;
    this.baseMinSqScale = params.textureScaleOverride ?? baseScaleForYield(perPatchDensity(params.population));
    this.minSqScale = this.baseMinSqScale;

    if (this.wallsNeeded && params.population < MIN_POPULATION_FOR_WALLS) {
      this.wallsNeeded = false;
      this.degradedFlags.add('walls');
    }
  }

  /**
   * Run the 6-phase generation pipeline. Retries up to MAX_ATTEMPTS per pass;
   * if that exhausts, drops `walls` and retries, then drops `citadel` and
   * retries. Only throws when every fallback has been exhausted. Every drop
   * is recorded on `degradedFlags` so consumers can tell "FMG didn't ask for
   * this" from "settlemaker couldn't build it".
   */
  generate(): Model {
    if (this.tryGenerate()) return this;

    if (this.wallsNeeded) {
      this.wallsNeeded = false;
      this.degradedFlags.add('walls');
      if (this.tryGenerate()) return this;
    }

    if (this.citadelNeeded) {
      this.citadelNeeded = false;
      this.degradedFlags.add('citadel');
      if (this.tryGenerate()) return this;
    }

    throw new Error(
      `Failed to generate after ${MAX_ATTEMPTS} attempts with walls/citadel fallbacks`,
    );
  }

  /**
   * Cheap alternative to `generate()` for callers that only need
   * `border.getRadius()` (phases 1-3 fully determine it; streets, wards, and
   * geometry never affect it). Mirrors `generate()`'s retry/degrade ladder,
   * but only over phases 1-3 (buildPatches/optimizeJunctions/buildWalls) —
   * it never runs phases 4-6 (buildStreets/createWards/buildGeometry), so it
   * cannot see a phase 4-6 failure (e.g. "Unable to build a street!") that
   * would make a full `generate()` retry past this probe's first successful
   * mesh. When phases 4-6 don't retry, the radius matches a full
   * `generate()` exactly. When they do, `generate()`'s pass 2 lands on a
   * different mesh than this probe saw, and the radius can differ — measured
   * 12/60 mismatches across pops 350/4200/20000 x seeds 1-20, up to ~5.7%
   * divergence (see fidelity-round4.test.ts). The consequence is bounded:
   * this radius feeds only `computeOriginShift`, so a mismatch means a
   * slightly mis-sized coast pull (and, near `MAX_SHIFT_MULTIPLIER`, a
   * possible coast_pull/coast_too_far flip) — both the SVG and GeoJSON
   * outputs consume the same shift, so a given run's output stays
   * self-consistent and deterministic regardless. Only throws when every
   * fallback (walls, then citadel) has been exhausted.
   */
  probeWallRadius(): number {
    if (this.tryProbe()) return this.border!.getRadius();

    if (this.wallsNeeded) {
      this.wallsNeeded = false;
      this.degradedFlags.add('walls');
      if (this.tryProbe()) return this.border!.getRadius();
    }

    if (this.citadelNeeded) {
      this.citadelNeeded = false;
      this.degradedFlags.add('citadel');
      if (this.tryProbe()) return this.border!.getRadius();
    }

    throw new Error(
      `Failed to probe wall radius after ${MAX_ATTEMPTS} attempts with walls/citadel fallbacks`,
    );
  }

  private tryProbe(): boolean {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        this.buildPatches();
        this.optimizeJunctions();
        this.buildWalls();
        return true;
      } catch (e) {
        this.reset();
      }
    }
    return false;
  }

  private tryGenerate(): boolean {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        this.build();
        return true;
      } catch (e) {
        this.reset();
      }
    }
    return false;
  }

  private reset(): void {
    this.patches = [];
    this.inner = [];
    this.waterbody = [];
    this.citadel = null;
    this.plaza = null;
    this.harbour = null;
    this.border = null;
    this.wall = null;
    this.gates = [];
    this.streets = [];
    this.roads = [];
    this.arteries = [];
    this.plazaRingSegments = new Set();
    this.topology = null;
    this.syntheticCoast = null;
    this.minSqScale = this.baseMinSqScale;
    this.pretrimOrdinaryCount = 0;
    this.pretrimCoreOrdinaryCount = 0;
  }

  private build(): void {
    this.streets = [];
    this.roads = [];
    this.plazaRingSegments = new Set();

    this.buildPatches();
    this.optimizeJunctions();
    this.buildWalls();
    this.classifyWater();
    this.placeHarbour();
    // `buildWalls` towered the circuit against the gate set as it stood then;
    // `classifyWater` drops waterfront road gates and `placeHarbour` adds the
    // sea gate, so a coastal wall's gate set is only final here. Re-tower so
    // a demoted gate gets its tower back and the harbour gate doesn't get one.
    // Deterministic and gate-driven — a no-op when nothing moved the gates.
    if (this.wall !== null && this.waterbody.length > 0) this.wall.buildTowers();
    this.buildStreets();
    this.createWards();
    this.buildGeometry();
  }

  // Phase 1: Build Voronoi patches
  private buildPatches(): void {
    const rng = this.rng;
    const sa = rng.float() * 2 * Math.PI;

    // Seed points at controlled density rather than the historical linear
    // spiral (`r = 10 + i*(2+rand)`), whose density fell off as 1/r — patch
    // area grew linearly with distance from the centre, so once the mesh was
    // kept out to radius*12 for sprawl, every farm/countryside patch was
    // 2-8x the area of a city ward. The farm belt (measured in adjacency
    // hops) then covered ~3.6x the built settlement's area and read as
    // landscape instead of a ring, and — since farms carry visible ink —
    // ballooned the frame until the settlement was a speck (~20% of the
    // image at pop 4000).
    //
    // Here the cell size stays uniform (matched to core-ward size) out to
    // `uniformR`, which must cover the built settlement plus its sprawl
    // (ribbons reach ~4x the core radius along roads) plus the farm belt
    // just outside the built edge; beyond it cells coarsen linearly, so
    // the far wilderness stays cheap. Radial step per point follows from
    // the target cell area s²: d(πr²)/di = s(r)² → dr = s²/(2πr).
    //
    // Round-cores-faubourgs task 5, fix round 1 (2026-08-09): the core-ward
    // cell size `s0` (and, via it, `coreR`) used to derive from a legacy
    // spiral constant (`coreR = 10 + nCore * 2.5`) with no relationship to
    // how much area the buildings actually generated inside it need. The
    // owner's fix-round-1 verdict at pop 1200/4000/10000: "largely empty
    // inside", "should be PACKED". `patchAreaForDemand` sizes the core
    // patch from ACTUAL demand instead — `buildingsPerCorePatch(population)`
    // buildings (measured yield, not the nominal `perPatchDensity` target —
    // see that function's doc comment for why the distinction mattered) of
    // `meanBuildingArea` each, at `targetCoverage(population)` — and `coreR`
    // is derived FROM that area (inverting `s0 = coreR * sqrt(pi / nCore)`),
    // not the other way around.
    //
    // Fix round 2 scaled `ward.ts`'s per-edge insets with population
    // (`edgeInsetScale`) so a fixed absolute street width stopped eating a
    // growing share of a shrinking patch. Fix round 3 (2026-08-10) found
    // the term that actually governs this radius: core area is roughly
    // `buildingBudget * meanBuildingArea / targetCoverage`, so with the
    // census fixed, only house size and coverage can move the wall. Both
    // moved -- see `baseScaleForYield` (city texture is now finer than
    // village texture, not coarser) and `tryEmitBuilding` in `ward.ts`
    // (lots are emitted whole instead of shrunk to an inscribed rectangle).
    // Measured, seeds 1-5, pop 1200/4000/10000: radius 39.60/55.33/78.87 ->
    // 28.95/39.98/56.92, coverage 0.433/0.507/0.523 -> 0.578/0.695/0.689.
    const s0 = Math.sqrt(patchAreaForDemand(this.params.population));
    this.cellSize = s0;
    const coreR = s0 * Math.sqrt(this.nCore / Math.PI);
    // Classify water against the estimated core radius before core
    // selection runs, so the core (and later the wall) never straddles the
    // coast. `ensureWaterRings` caches on first call per attempt (reset() in
    // the retry ladder clears `syntheticCoast`), so this is the ONE place
    // the synthetic ring's radius is chosen for this pass; classifyWater
    // just reads the cached rings back.
    this.ensureWaterRings(coreR);
    const uniformR = 4 * coreR;
    const maxR = 12 * coreR;
    const points: Point[] = [new Point(0, 0)];
    let r = s0 * 0.6;
    for (let i = 1; r < maxR && i < 20000; i++) {
      const a = sa + i * GOLDEN_ANGLE;
      const jr = r * (0.9 + 0.2 * rng.float());
      points.push(new Point(Math.cos(a) * jr, Math.sin(a) * jr));
      const s = r <= uniformR ? s0 : s0 * (1 + (r - uniformR) / coreR);
      r += (s * s) / (2 * Math.PI * r);
    }

    let voronoi = Voronoi.build(points);

    // Relax central wards
    for (let i = 0; i < 3; i++) {
      const toRelax: Point[] = [];
      for (let j = 0; j < 3 && j < voronoi.points.length; j++) {
        toRelax.push(voronoi.points[j]);
      }
      if (this.nCore < voronoi.points.length) {
        toRelax.push(voronoi.points[this.nCore]);
      }
      voronoi = Voronoi.relax(voronoi, toRelax);
    }

    // Mild seeded ovoid: the walled core is relatively circular/ovoid; routes
    // and terrain shape the OUTSIDE (spec 2026-08-09 §2). Water never joins
    // the core.
    const ecc = 1 + rng.float() * 0.25;
    const axisA = rng.float() * Math.PI;
    const cosA = Math.cos(axisA), sinA = Math.sin(axisA);
    const hasWater = this.getWaterRings().length > 0;
    const coreRank = (p: Point): number => {
      if (hasWater && this.isWaterAt(p)) return Infinity;
      const u = p.x * cosA + p.y * sinA;
      const v = -p.x * sinA + p.y * cosA;
      return Math.hypot(u / ecc, v);
    };

    // Decorate-sort-undecorate: coreRank (one isWaterAt probe plus the ovoid
    // distance) is computed once per point instead of twice per comparison.
    // At pop 200000 (~44k points) a naive comparator reran it ~2*n*log2(n)
    // times per buildPatches call, and buildPatches reruns on every retry in
    // the generate() ladder.
    const decorated = voronoi.points.map((p): [Point, number] => [p, coreRank(p)]);
    decorated.sort((a, b) => sign(a[1] - b[1]));
    voronoi.points = decorated.map(([p]) => p);
    const regions = voronoi.partitioning();

    this.patches = [];
    this.inner = [];
    this.citadel = null;

    let count = 0;
    const sortedPatches: Patch[] = [];
    for (const r of regions) {
      const patch = Patch.fromRegion(r);
      this.patches.push(patch);
      sortedPatches.push(patch);

      if (count === 0) {
        // Find vertex closest to origin for center
        this.center = minBy(patch.shape.vertices, (p: Point) => p.length);
        if (this.plazaNeeded) {
          this.plaza = patch;
        }
        // The origin-closest patch is always core, independent of the water
        // tiering below — it's the settlement's own centre (and the plaza
        // candidate), not a boundary patch subject to coastline exclusion.
        // Forcing it in here preserves the pre-existing invariant that this
        // patch is always in `inner`; without it, a wet-vertex origin patch
        // could fall behind land patches in the tiers and get excluded from
        // `inner` entirely while still being `this.plaza` — leaving the
        // plaza pointing at a patch outside the core.
        patch.withinCity = true;
        patch.withinWalls = this.wallsNeeded;
        this.inner.push(patch);
      }

      count++;
    }

    // Water exclusion for core (and citadel) membership: `coreRank` already
    // pushed water *seed points* to the end of `sortedPatches`, but a
    // patch's Voronoi cell can still straddle the coast even when its seed
    // is dry, so selection still needs a land/shoreline/water split here.
    // Tiered so a land-starved layout (e.g. a settlement on a narrow spit,
    // narrower than one patch) degrades gracefully instead of failing to
    // generate at all: prefer patches whose centroid AND every vertex are on
    // land (buildWalls later walks patch edges, so a vertex-only-wet
    // boundary patch would still leave a wall vertex in the water — see
    // coastal-core.test.ts); fall back to centroid-only land if that tier
    // can't fill the core; fall back to any remaining patch (the old,
    // water-blind behaviour) only if land is too scarce for either.
    //
    // Single pass over `sortedPatches`, each patch classified once (not the
    // three redundant re-filtering passes this replaced — that tripled
    // isWaterAt calls and measured a 3.4x buildPatches slowdown at pop
    // 200000 coastal).
    const strictTier: Patch[] = [];
    const centroidTier: Patch[] = [];
    const waterTier: Patch[] = [];
    for (const patch of sortedPatches) {
      if (this.isWaterAt(patch.shape.center)) {
        waterTier.push(patch);
      } else if (patch.shape.vertices.some(v => this.isWaterAt(v))) {
        centroidTier.push(patch);
      } else {
        strictTier.push(patch);
      }
    }
    const tiers = [strictTier, centroidTier, waterTier];

    for (const tier of tiers) {
      for (const patch of tier) {
        if (this.inner.length >= this.nCore) break;
        if (patch.withinCity) continue; // already forced in (the origin patch)
        patch.withinCity = true;
        patch.withinWalls = this.wallsNeeded;
        this.inner.push(patch);
      }
      if (this.inner.length >= this.nCore) break;
    }

    if (this.citadelNeeded) {
      const innerSet = new Set(this.inner);
      for (const tier of tiers) {
        const next = tier.find(p => !innerSet.has(p));
        if (next) {
          this.citadel = next;
          this.citadel.withinCity = true;
          break;
        }
      }
    }

    // Built here, right after selection, because enforceCoreConnectivity
    // (below) needs neighbour lookups on the just-built mesh. It goes stale
    // after optimizeJunctions merges vertices and buildWalls filters
    // this.patches, so createWards rebuilds it on the settled geometry.
    this.adjacency = buildAdjacency(this.patches);
    this.enforceCoreConnectivity();
  }

  /**
   * Keep only the connected component of `inner` containing the centre,
   * then top up from adjacent unselected patches until nCore is reached.
   * A disconnected core makes findCircumference walk a spurious boundary
   * (the round-4 failure mode), so this runs before buildWalls.
   */
  private enforceCoreConnectivity(): void {
    if (this.inner.length === 0) return;
    const adj = this.adjacency!;
    const innerSet = new Set(this.inner);

    // Flood-fill from the centre patch through inner patches only.
    const seed = this.inner[0];
    const connected = new Set<Patch>([seed]);
    let frontier = [seed];
    while (frontier.length > 0) {
      const next: Patch[] = [];
      for (const p of frontier) {
        for (const n of adj.neighboursOf(p)) {
          if (innerSet.has(n) && !connected.has(n)) { connected.add(n); next.push(n); }
        }
      }
      frontier = next;
    }

    if (connected.size === this.inner.length) return;

    // Drop strays, then grow back to nCore through adjacency so the count
    // (and so the population the core holds) is preserved.
    for (const p of this.inner) {
      if (!connected.has(p)) { p.withinCity = false; p.withinWalls = false; }
    }
    this.inner = this.inner.filter(p => connected.has(p));

    while (this.inner.length < this.nCore) {
      const candidates = new Set<Patch>();
      const fallbackCandidates = new Set<Patch>();
      for (const p of this.inner) {
        for (const n of adj.neighboursOf(p)) {
          // Exclude the citadel explicitly (buildPatches picks it as the
          // nearest unselected patch in tier order right after core
          // selection, so it is very often the top-up's nearest-centre pick
          // too) and, defensively, any patch that already has a ward
          // assigned. Absorbing the citadel into `inner` would make
          // createWards overwrite its Castle with an ordinary ward while
          // buildWalls's castle gates and this.citadel both still point at
          // it — a silent "citadel present but no Castle" defect.
          if (n === this.citadel) continue;
          if (n.ward !== null) continue;
          if (connected.has(n)) continue;
          // Water exclusion (see buildPatches's tiering): prefer a patch
          // that doesn't touch water (centroid or any vertex) at all; only
          // fall back to a water-touching one if that's all that's left, so
          // a land-starved layout still tops up instead of stalling forever.
          if (!this.isWaterAt(n.shape.center) && !n.shape.vertices.some(v => this.isWaterAt(v))) {
            candidates.add(n);
          } else {
            fallbackCandidates.add(n);
          }
        }
      }
      const pool = candidates.size > 0 ? candidates : fallbackCandidates;
      if (pool.size === 0) break;
      const best = minBy([...pool], (p: Patch) => p.shape.center.length);
      connected.add(best);
      best.withinCity = true;
      best.withinWalls = this.wallsNeeded;
      this.inner.push(best);
    }
  }

  // Phase 2: Merge close junctions
  private optimizeJunctions(): void {
    // Junction merge threshold. The Haxe reference's flat 8 units is a
    // fraction of ITS mesh cell — with `patchAreaForDemand` now sizing
    // cells from building demand, that fraction moves with population, and
    // round-cores-faubourgs task 5 fix round 3 shrank the city cell far
    // enough (s0 18.3 -> 12.2 at pop 1200) that a flat 8 collapsed roughly
    // half of every patch edge, producing shapes the curtain wall could not
    // enclose ("Bad walled area shape" -- measured 2 of 5 seeds losing
    // their walls outright at pop 1200, against 0 of 5 before). Row-housed
    // settlements therefore merge at a FRACTION of their own cell size,
    // which is what the constant always meant; villages keep the literal 8
    // (their cell size is unchanged, and their output must stay byte-
    // stable).
    const mergeDist = rowHousing(this.params.population)
      ? JUNCTION_MERGE_FRACTION * this.cellSize
      : 8;
    const patchesToOptimize = this.citadel === null
      ? this.inner
      : this.inner.concat([this.citadel]);

    const wards2clean: Patch[] = [];
    for (const w of patchesToOptimize) {
      let index = 0;
      while (index < w.shape.length) {
        const v0 = w.shape.vertices[index];
        const v1 = w.shape.vertices[(index + 1) % w.shape.length];

        if (v0 !== v1 && Point.distance(v0, v1) < mergeDist) {
          for (const w1 of this.patchByVertex(v1)) {
            if (w1 !== w) {
              const vIdx = w1.shape.indexOf(v1);
              if (vIdx !== -1) w1.shape.vertices[vIdx] = v0;
              wards2clean.push(w1);
            }
          }

          v0.addEq(v1);
          v0.scaleEq(0.5);

          const rmIdx = w.shape.indexOf(v1);
          if (rmIdx !== -1) w.shape.vertices.splice(rmIdx, 1);
        }
        index++;
      }
    }

    // Remove duplicate vertices
    for (const w of wards2clean) {
      for (let i = 0; i < w.shape.length; i++) {
        const v = w.shape.vertices[i];
        let dupIdx: number;
        while ((dupIdx = w.shape.indexOf(v, i + 1)) !== -1) {
          w.shape.vertices.splice(dupIdx, 1);
        }
      }
    }
  }

  // Phase 3: Build walls
  private buildWalls(): void {
    const reserved = this.citadel !== null ? this.citadel.shape.copy() : [];

    this.border = new CurtainWall(this.wallsNeeded, this, this.inner, reserved, this.rng, this.params.roadEntryPoints);

    // `findCircumference` can — rarely, and pre-existing (confirmed present
    // even at the historical n≤60 scale) — terminate on a wrong boundary that
    // still passes its own walk-termination guard, encoding a polygon that
    // doesn't actually contain the requested inner patches. Enclosure is the
    // cheapest reliable tell: a correct circumference must contain nearly
    // every inner patch's centroid. Failing that, throw so the ladder
    // retries with the rng advanced past the bad draw, exactly like any
    // other recoverable generation failure. Below 10 inner patches, `enclosed`
    // and `inner.length` are both small integers and the strict `<` against
    // the non-integer `*0.9` cutoff already demands 100% enclosure (e.g. for
    // inner.length=9, 0.9*9=8.1, so enclosed=8 still throws) — no separate
    // small-n case needed.
    //
    // Measured (round-4 final review): 12 throws across 160 village runs
    // (pops 200/400/700/1000 x seeds 1-40) vs 0 across 30 city runs (pops
    // 5000/20000/70000 x seeds 1-10) — this fires at village scale, in fact
    // only there in the sampled sweep, not preferentially at large footprints.
    const enclosed = this.inner.filter(
      p => pointInPolygon(p.shape.center, this.border!.shape.vertices),
    ).length;
    if (this.inner.length > 0 && enclosed < this.inner.length * 0.9) {
      throw new Error('Bad walled area shape: circumference does not enclose the inner patches!');
    }

    if (this.wallsNeeded) {
      this.wall = this.border;
      this.wall.buildTowers();
    }

    const radius = this.border.getRadius();
    // Sprawl reaches ~4x the core radius along roads, plus satellites beyond
    // that; keep enough countryside for both, and for the farm belt outside
    // them. (Was `radius * 3`, which assumed the wall bounded the settlement.)
    const keepRadius = radius * 12;
    this.patches = this.patches.filter(p => p.shape.distance(this.center) < keepRadius);

    this.gates = this.border.gates.slice();

    if (this.citadel !== null) {
      const castle = new Castle(this, this.citadel);
      castle.wall.buildTowers();
      this.citadel.ward = castle;

      if (this.citadel.shape.compactness < 0.75) {
        throw new Error('Bad citadel shape!');
      }

      this.gates = this.gates.concat(castle.wall.gates);
    }
  }

  /**
   * Water rings for this generation pass: the caller-supplied vector
   * coastline when present, else a coastline synthesized from
   * `oceanBearing` (cached in `syntheticCoast` after the first call), else
   * `[]` for a landlocked burg. Idempotent per attempt — `reset()` clears
   * `syntheticCoast` between retries in the generation ladder, so the first
   * call each attempt re-synthesizes and every later call in that attempt
   * reads the cache back.
   *
   * Called from `buildPatches` (right after `coreR` is known) so core
   * selection can exclude water before the wall is ever drawn; `radius`
   * therefore is the *estimated* core radius, not `border.getRadius()`
   * (which doesn't exist yet at that point in the pipeline). Wobble phases
   * derive from `params.seed` arithmetically — no rng stream draws — so
   * moving the synthesis earlier does not change layouts per seed.
   */
  private ensureWaterRings(radius: number): Point[][] {
    const coast = this.params.coastlineGeometry;
    const hasCoast = coast != null && coast.length > 0 && coast.some(p => p.length >= 3);
    if (hasCoast) return this.getWaterRings();

    if (this.params.oceanBearing == null) return [];
    if (this.syntheticCoast !== null) return this.syntheticCoast;

    // Synthesize an organic coastline from the bearing, then classify
    // against it exactly like a caller-supplied ring — one water
    // definition for placement, drowning, road clipping, AND painting.
    const rad = this.params.oceanBearing * Math.PI / 180;
    const oceanDirX = Math.sin(rad);
    const oceanDirY = -Math.cos(rad);
    const threshold = radius * 0.3;
    const R = radius * 20;
    const tx = -oceanDirY, ty = oceanDirX;
    const seed = this.params.seed;
    const p1 = (seed % 97) * 0.13, p2 = (seed % 71) * 0.29, p3 = (seed % 53) * 0.41;
    const ring: Point[] = [];
    const step = radius * 0.2;
    for (let s = -R; s <= R; s += step) {
      const w = radius * (
        0.09 * Math.sin(s / (radius * 0.9) + p1) +
        0.05 * Math.sin(s / (radius * 0.31) + p2) +
        0.02 * Math.sin(s / (radius * 0.11) + p3)
      );
      const d = threshold + w;
      ring.push(new Point(tx * s + oceanDirX * d, ty * s + oceanDirY * d));
    }
    ring.push(new Point(tx * R + oceanDirX * R, ty * R + oceanDirY * R));
    ring.push(new Point(-tx * R + oceanDirX * R, -ty * R + oceanDirY * R));
    this.syntheticCoast = [ring];
    return this.syntheticCoast;
  }

  // Phase 3.5: Classify water patches for port cities
  private classifyWater(): void {
    const coast = this.params.coastlineGeometry;
    const hasCoast = coast != null && coast.length > 0 && coast.some(p => p.length >= 3);
    const hasBearing = this.params.oceanBearing != null;
    if (!hasCoast && !hasBearing) return;

    // Rings were already synthesized/cached from buildPatches (or supplied
    // by the caller); classifyWater just reads them back via isWaterAt.
    // Prefer the caller-supplied coastline: patch is water iff its centroid
    // lies inside an ODD number of the supplied rings (even-odd fill rule).
    // Callers may pass polygon holes as additional rings: a centroid inside
    // a lake's outer ring AND inside an island hole counts twice → land.
    // Hole-less inputs degrade to the old "inside any ring" behavior, since
    // disjoint water bodies can't nest. Rings must not partially overlap
    // (PostGIS ST_Union output satisfies this).
    let isWater: (patch: Patch) => boolean;
    if (hasCoast) {
      isWater = (patch) => {
        const c = patch.shape.center;
        let containing = 0;
        for (const poly of coast!) {
          if (poly.length >= 3 && pointInPolygon(c, poly)) containing++;
        }
        return containing % 2 === 1;
      };
    } else {
      isWater = (patch) => this.isWaterAt(patch.shape.center);
    }

    for (const patch of this.patches) {
      if (patch.withinCity) continue;
      if (patch.ward !== null) continue;
      if (isWater(patch)) this.waterbody.push(patch);
    }

    // The wall is NOT opened where it faces water. A walled ocean settlement
    // carries its curtain along the water's edge too (spec §6, Saint-Malo):
    // the circuit stays closed, towers and all, and the only way through to
    // the water is the harbour gate placed by `placeHarbour`.

    // Remove border gates on the waterfront so no streets/roads extend into water
    if (this.waterbody.length > 0) {
      const isWaterfrontGate = (gate: Point): boolean =>
        this.waterbody.some(wp => wp.shape.contains(gate));

      const landGates = this.border!.gates.filter(g => !isWaterfrontGate(g));

      // Only remove if at least one land gate remains
      if (landGates.length > 0) {
        const removed = new Set(this.border!.gates.filter(g => isWaterfrontGate(g)));
        this.border!.gates = landGates;
        this.gates = this.gates.filter(g => !removed.has(g));
        for (const g of removed) this.border!.gateMeta.delete(g);
      }
    }
  }

  // Phase 3.6: Place harbour ward on waterfront
  private placeHarbour(): void {
    if (this.params.harbourSize == null || this.waterbody.length === 0) return;

    const large = this.params.harbourSize === 'large';

    // Candidates preferred: outer patches bordering the city whose shape
    // STRADDLES the painted shoreline (mixed wet/dry vertices) — the
    // harbour district then sits at the visible waterline, warehouses on
    // painted land, piers over painted water. Scored by total length of
    // shore-crossing edges, restricted to edges that are ALSO shared with a
    // `waterbody` patch: `Harbour.createPiers()` anchors piers by walking
    // exactly those shared edges, so a mixed-vertex edge that isn't shared
    // with any water-classified patch (an internal Voronoi artifact, not a
    // real waterfront) would qualify a patch as "straddling" yet leave
    // createPiers walking a *different*, fully-wet shared edge with no dry
    // anchor — rescueDetachedPier then has nothing to slide onto and drops
    // the pier. Restricting the score to shared+crossing edges keeps the
    // winning patch's actual pier-anchor edges at the visible shoreline.
    // Fallback: the old waterbody-patch-adjacency scoring (any shared edge,
    // crossing or not), so small meshes where no patch straddles still get
    // a port.
    const straddling: Array<{ patch: Patch; waterfrontLength: number }> = [];
    const adjacent: Array<{ patch: Patch; waterfrontLength: number }> = [];

    for (const patch of this.patches) {
      if (patch.withinCity) continue;
      if (patch.ward !== null) continue;
      if (this.waterbody.includes(patch)) continue;
      if (!this.getNeighbours(patch).some(n => n.withinCity)) continue;

      let shoreLength = 0;
      let sharedLength = 0;
      patch.shape.forEdge((v0, v1) => {
        for (const wp of this.waterbody) {
          if (wp.shape.findEdge(v1, v0) !== -1) {
            const len = Point.distance(v0, v1);
            sharedLength += len;
            if (this.isWaterAt(v0) !== this.isWaterAt(v1)) shoreLength += len;
            break;
          }
        }
      });

      if (shoreLength > 0) {
        straddling.push({ patch, waterfrontLength: shoreLength });
      } else if (sharedLength > 0) {
        adjacent.push({ patch, waterfrontLength: sharedLength });
      }
    }

    const candidates = straddling.length > 0 ? straddling : adjacent;
    if (candidates.length === 0) return;

    // Pick the patch with the most waterfront edge length
    candidates.sort((a, b) => b.waterfrontLength - a.waterfrontLength);
    const best = candidates[0].patch;

    best.withinCity = true;
    best.ward = new Harbour(this, best, large);
    this.harbour = best;

    // Add a gate where the harbour meets the wall so streets connect to it
    if (this.border !== null) {
      const wallVerts = this.border.shape.vertices;
      const harbourGate = wallVerts.find(v => best.shape.contains(v));
      if (harbourGate) {
        if (!this.gates.includes(harbourGate)) this.gates.push(harbourGate);
        // Also register on the wall's own gate list. `CurtainWall.buildTowers`
        // and the SVG/GeoJSON wall pass (`wallFeature`) both read
        // `border.gates`/`wall.gates`, not `model.gates` — without this the
        // harbour vertex is a bare wall corner: no gate bar, and (until the
        // post-placeHarbour re-tower in `build()`) a tower sealing the quay
        // shut. Deliberately NOT excluded from `buildStreets`' outward-road
        // pass by omission anymore; see the sea-only-route guard there
        // instead, which is more precise (it also protects a caller-supplied
        // land gate that happens to coincide with the harbour vertex).
        if (!this.border.gates.includes(harbourGate)) this.border.gates.push(harbourGate);
        // Tag it so the GeoJSON output can render it as a harbour-kind gate.
        // The vertex may ALREADY be a road gate (the landward approach and the
        // quay can meet at the same corner of the circuit) — in that case the
        // sea route is prepended to the existing routes rather than skipped,
        // so the harbour is never left opening through an untagged road gate.
        const vertexIndex = wallVerts.indexOf(harbourGate);
        const bearingDeg = ((Math.atan2(harbourGate.x, -harbourGate.y) * 180 / Math.PI) % 360 + 360) % 360;
        const normalisedBearing = Math.round(bearingDeg * 10) / 10;
        const existing = this.border.gateMeta.get(harbourGate);
        const seaRoute = {
          kind: 'sea' as const,
          requestedBearingDeg: normalisedBearing,
          matchDeltaDeg: 0,
        };
        this.border.gateMeta.set(harbourGate, {
          wallVertexIndex: vertexIndex,
          bearingDeg: normalisedBearing,
          kind: 'sea',
          routes: [seaRoute, ...(existing?.routes ?? [])],
          ...(existing?.routeId != null ? { routeId: existing.routeId } : {}),
          matchDeltaDeg: 0,
        });
      }
    }
  }

  // Phase 4: Build streets
  private buildStreets(): void {
    const routeAware = this.params.roadEntryPoints != null;

    const smoothStreet = (street: Polygon) => {
      const smoothed = street.smoothVertexEq(3);
      for (let i = 1; i < street.length - 1; i++) {
        street.vertices[i].set(smoothed.vertices[i]);
      }
    };

    this.topology = new Topology(this);

    // Distinct plaza vertices this loop actually lands a street on — each
    // gate routes to whichever plaza corner is nearest IT, so different
    // approaches end at different corners with nothing between them. Fed to
    // the junction-ring builder below.
    const plazaEnds = new Set<Point>();

    for (const gate of this.gates) {
      const end = this.plaza !== null
        ? minBy(this.plaza.shape.vertices, v => Point.distance(v, gate))
        : this.center;

      const street = this.topology.buildPath(gate, end, this.topology.outer);
      if (street !== null) {
        this.streets.push(new Polygon(street));
        if (this.plaza !== null) plazaEnds.add(end);

        if (this.border!.gates.includes(gate)) {
          const routes = this.border!.gateMeta.get(gate)?.routes ?? [];
          const hasRoute = routes.length > 0;
          // A gate whose ONLY route is the harbour's sea route (`placeHarbour`)
          // exists purely so the wall renders a gate mark on the quay — it
          // must never grow an outward LAND road toward the water. A gate
          // that mixes a sea route with a land route (the quay happened to
          // land on an existing road gate) keeps building its land road as
          // normal: only the all-sea case is sea-only.
          const seaOnly = routes.length > 0 && routes.every(r => r.kind === 'sea');
          if (!seaOnly && (!routeAware || hasRoute)) {
            const dir = gate.norm(1000);
            let start: Point | null = null;
            let dist = Infinity;
            for (const [, pt] of this.topology.node2pt) {
              const d = Point.distance(pt, dir);
              if (d < dist) {
                dist = d;
                start = pt;
              }
            }

            if (start) {
              const road = this.topology.buildPath(start, gate, this.topology.inner);
              if (road !== null) {
                this.roads.push(new Polygon(road));
              }
            }
          }
        }
      } else {
        throw new Error('Unable to build a street!');
      }
    }

    this.buildPlazaJunctionRing(plazaEnds);
    this.clipRoadsAtWater();
    this.tidyUpRoads();

    for (const a of this.arteries) {
      smoothStreet(a);
    }
  }

  /**
   * Owner's ruling (spec §7): "the smaller places where routes terminate
   * inside a burg, they should join... the roads will always actually
   * join." Each gate's street lands on whichever plaza vertex is nearest
   * THAT gate — two, three, more approaches can each end at a different
   * corner with nothing drawn between them, reading as disconnected stubs
   * around the square. Walk the plaza's own perimeter and add every edge as
   * a street segment, so all the corners actually used as endpoints (and
   * everything between them) are wired into one ring. A no-op below 2 used
   * corners: one approach already needs no ring to "join" — it has nothing
   * to join to.
   */
  private buildPlazaJunctionRing(plazaEnds: Set<Point>): void {
    if (this.plaza === null || plazaEnds.size < 2) return;

    const verts = this.plaza.shape.vertices;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const segment = new Polygon([a, b]);
      this.streets.push(segment);
      this.plazaRingSegments.add(segment);
    }
  }

  /**
   * Truncate external roads at the waterline: keep only the contiguous dry
   * HEAD starting at the gate, dropping the road entirely if fewer than two
   * dry vertices remain. `Graph.aStar`'s buildPath (graph.ts) reconstructs
   * goal-backward, and roads are built as `buildPath(start, gate)` above, so
   * `road.vertices[0]` IS the gate and the tail runs out to the far
   * countryside end — the dry ground worth keeping is therefore the prefix
   * up to (not including) the first wet vertex, not a suffix. Cheap
   * placeholder for shore-aware routing — a road simply stops at the coast
   * instead of walking on the sea. Runs before tidyUpRoads so arteries
   * inherit the clipped geometry.
   */
  private clipRoadsAtWater(): void {
    if (this.getWaterRings().length === 0) return;
    this.roads = this.roads.flatMap(road => {
      let firstWet = -1;
      for (let i = 0; i < road.vertices.length; i++) {
        if (this.isWaterAt(road.vertices[i])) {
          firstWet = i;
          break;
        }
      }
      if (firstWet === -1) return [road];
      const dryHead = road.vertices.slice(0, firstWet);
      return dryHead.length >= 2 ? [new Polygon(dryHead)] : [];
    });
  }

  private tidyUpRoads(): void {
    const segments: Segment[] = [];

    const cut2segments = (street: Polygon) => {
      let v0: Point | null = null;
      let v1 = street.vertices[0];
      for (let i = 1; i < street.length; i++) {
        v0 = v1;
        v1 = street.vertices[i];

        // Skip segments along the plaza — except the junction-ring segments
        // `buildPlazaJunctionRing` built deliberately to run along the
        // plaza edge and join the approaches; those must survive this cut.
        if (this.plaza !== null &&
            this.plaza.shape.contains(v0) &&
            this.plaza.shape.contains(v1) &&
            !this.plazaRingSegments.has(street)) {
          continue;
        }

        let exists = false;
        for (const seg of segments) {
          if (seg.start === v0 && seg.end === v1) {
            exists = true;
            break;
          }
        }

        if (!exists) {
          segments.push(new Segment(v0, v1));
        }
      }
    };

    for (const street of this.streets) cut2segments(street);
    for (const road of this.roads) cut2segments(road);

    this.arteries = [];
    while (segments.length > 0) {
      const seg = segments.pop()!;

      let attached = false;
      for (const a of this.arteries) {
        if (a.vertices[0] === seg.end) {
          a.vertices.unshift(seg.start);
          attached = true;
          break;
        } else if (last(a.vertices) === seg.start) {
          a.vertices.push(seg.end);
          attached = true;
          break;
        }
      }

      if (!attached) {
        this.arteries.push(new Polygon([seg.start, seg.end]));
      }
    }
  }

  // Phase 5: Create wards
  private createWards(): void {
    // Rebuilt here (not reused from buildPatches) because optimizeJunctions
    // merged/spliced vertices and buildWalls filtered this.patches since
    // then — the phase-1 index would hold stale vertex identities and
    // references to patches no longer in this.patches. Downstream consumers
    // (zoning, field placement) need adjacency over this settled geometry.
    this.adjacency = buildAdjacency(this.patches);

    // routeWeights draws exactly one rng.float() per entry (the jitter),
    // regardless of the data on each entry, so this call site's rng draw
    // count is deterministic across inputs — required for pinned-hash
    // stability of downstream phases.
    const roads = routeWeights(this.params.roadEntryPoints ?? [], this.rng);

    this.urbanisationField = assignSprawl({
      patches: this.patches,
      inner: this.inner,
      adjacency: this.adjacency!,
      roads,
      coreRadius: this.border!.getRadius(),
      // The core is a mild seeded ovoid (not a perfect circle), so the
      // circumscribed radius alone would anchor the halo at the long-axis
      // tips and leave the ground near the short axis underscored. Hand the
      // field the actual outline.
      coreOutline: this.border!.shape.vertices,
      population: this.params.population,
      // Centroid-only was insufficient: a patch straddling the shoreline can
      // have a dry centroid with most of its body underwater (measured:
      // 11/179 built patches at a port-city fixture had 1-5 of their own
      // vertices submerged, several with a WET majority). Require every
      // vertex dry too.
      isBuildable: (p) =>
        p.ward === null && !this.waterbody.includes(p) &&
        !this.isWaterAt(p.shape.center) && !p.shape.vertices.some(v => this.isWaterAt(v)),
      // The citadel patch (when present) sits outside `this.inner` and is
      // never a sprawl candidate (it already has a Castle ward from
      // buildWalls, so isBuildable already excludes it) — but it still
      // consumes one of the nPatches total-budget slots. Reserve that slot
      // so core (inner.length) + citadel (1) + sprawl claimed up to this
      // budget never exceeds nPatches (and so MAX_PATCHES).
      budget: Math.max(0, this.nPatches - this.inner.length - (this.citadel !== null ? 1 : 0)),
    });

    // The citadel patch sits outside `this.inner` (buildPatches selects it
    // separately, right after the core) but already carries a Castle ward
    // from buildWalls, phases before this — assignSprawl's blanket "reset
    // everything to wilderness" leaves it 'wilderness' otherwise, which is
    // exactly the "built patch tagged wilderness" case the next task (Scene
    // / symbol library) has no rule for, and it drops out of any zone-based
    // built-patch count (measured: 221 real built patches counted as 220
    // whenever a citadel exists).
    if (this.citadel !== null) this.citadel.zone = 'core';

    const rng = this.rng;
    const unassigned = this.inner.slice();

    if (this.plaza !== null) {
      this.plaza.ward = new Market(this, this.plaza);
      const idx = unassigned.indexOf(this.plaza);
      if (idx !== -1) unassigned.splice(idx, 1);
    }

    // Assign inner city gate wards
    for (const gate of this.border!.gates) {
      for (const patch of this.patchByVertex(gate)) {
        if (patch.withinCity && patch.ward === null &&
            rng.bool(this.wall === null ? 0.2 : 0.5)) {
          patch.ward = new GateWard(this, patch);
          const idx = unassigned.indexOf(patch);
          if (idx !== -1) unassigned.splice(idx, 1);
        }
      }
    }

    // Build ward distribution
    const wards = buildWardDistribution(this.params);
    // Shuffle ~10% of elements
    for (let i = 0; i < Math.floor(wards.length / 10); i++) {
      const index = rng.int(0, wards.length - 1);
      const tmp = wards[index];
      wards[index] = wards[index + 1];
      wards[index + 1] = tmp;
    }

    // Assign inner city wards
    while (unassigned.length > 0) {
      const wardClass: WardConstructor = wards.length > 0 ? wards.shift()! : Slum;

      // Check if the ward class has a custom rateLocation
      const rateFunc = (wardClass as typeof Ward).rateLocation;

      let bestPatch: Patch;
      if (rateFunc === Ward.rateLocation) {
        // No custom rating — pick random unassigned
        do {
          bestPatch = randomElement(unassigned, rng);
        } while (bestPatch.ward !== null && unassigned.some(p => p.ward === null));
      } else {
        bestPatch = minBy(unassigned, (patch: Patch) =>
          patch.ward === null ? rateFunc(this, patch) : Infinity,
        );
      }

      bestPatch.ward = new wardClass(this, bestPatch);
      const idx = unassigned.indexOf(bestPatch);
      if (idx !== -1) unassigned.splice(idx, 1);
    }

    // Outskirts
    if (this.wall !== null) {
      // Hard cap by construction: MAX_PATCHES was fitted to an 8-second
      // generation budget, and this loop is independent of assignSprawl's
      // budget (bounded only by gate count, not population) — an explicit
      // coreCapacity can make nCore == nPatches (assignSprawl's budget is
      // then 0) with several gates still producing new built patches here,
      // pushing the total well past MAX_PATCHES (measured: 242-244 built at
      // pop 250000 with coreCapacity >= ~0.75x population). Track the
      // running built total (core+suburb+satellite) and refuse to claim
      // once it reaches the cap — no reservation arithmetic, an input
      // simply cannot bypass this.
      let builtCount = this.patches.reduce(
        (n, p) => n + (p.zone === 'core' || p.zone === 'suburb' || p.zone === 'satellite' ? 1 : 0), 0,
      );
      for (const gate of this.wall.gates) {
        if (!rng.bool(1 / Math.max(2, this.nCore - 5))) {
          for (const patch of this.patchByVertex(gate)) {
            if (patch.ward === null) {
              if (builtCount >= MAX_PATCHES) continue;
              // This loop bypassed assignSprawl's isBuildable check entirely
              // (measured: at a port fixture, several seeds produced fully
              // submerged 'suburb'-zoned outskirts patches). Same predicate:
              // reject a wet centroid or any wet vertex.
              if (this.waterbody.includes(patch) || this.isWaterAt(patch.shape.center) ||
                  patch.shape.vertices.some(v => this.isWaterAt(v))) continue;
              patch.withinCity = true;
              patch.ward = new GateWard(this, patch);
              // A GateWard patch outside the walls is built fabric, same as
              // a suburb ribbon patch — matters downstream (the Scene/symbol
              // library task carries `zone` forward and has no rule for a
              // built patch tagged 'wilderness'). Only patches assignSprawl
              // left unclaimed reach here still 'wilderness'; a patch it
              // already zoned 'suburb'/'satellite' keeps that label (and was
              // already counted in builtCount, so it's not double-counted).
              if (patch.zone === 'wilderness') { patch.zone = 'suburb'; builtCount++; }
            }
          }
        }
      }
    }

    // Extramural fabric: ordinary wards, denser near the walls, poorer further out.
    for (const patch of this.patches) {
      if (patch.ward !== null) continue;
      if (patch.zone === 'suburb') patch.ward = new CraftsmenWard(this, patch);
      else if (patch.zone === 'satellite') patch.ward = new Slum(this, patch);
    }

    // Build farmland with sinusoidal boundary
    this.buildFarms();

    // Faubourg back lanes — needs `patch.zone === 'suburb'` labels this
    // method just assigned, so it cannot run inside buildStreets (phase 4,
    // before zoning exists). Folds any new lane geometry back through
    // tidyUpRoads so buildGeometry (phase 6, next) sees it in `this.arteries`.
    this.buildFaubourgLanes();
  }

  /**
   * Fields hug the built edge. A patch becomes farmland when it is near built
   * fabric but not itself built, measured in ADJACENCY HOPS rather than by
   * radius — a radius cannot track a lobed outline, and the previous
   * sinusoidal boundary (`a·sin(θ+c) + b·sin(2θ+d)` against one global
   * `cityRadius`, with unbounded normal-drawn amplitudes) could balloon over
   * one arc and go negative over another. With the mesh now reaching 12× the
   * wall radius so sprawl has countryside to occupy, that wave painted
   * farmland across a region far larger than the settlement, which dominated
   * the rendered frame.
   *
   * Belt depth scales with population: more mouths, more fields.
   */
  private buildFarms(): void {
    const rng = this.rng;

    this.cityRadius = 0;
    for (const patch of this.patches) {
      if (patch.withinCity) {
        for (const v of patch.shape.vertices) {
          this.cityRadius = Math.max(this.cityRadius, v.length);
        }
      }
    }

    const built = this.patches.filter(
      p => p.zone === 'core' || p.zone === 'suburb' || p.zone === 'satellite',
    );
    this.farmRingDepth = this.params.population >= 20000 ? 3
      : this.params.population >= 2000 ? 2
      : 1;

    const hops = this.adjacency!.hopDistances(built, this.farmRingDepth);
    for (const patch of this.patches) {
      patch.ringDepth = hops.get(patch) ?? -1;
    }

    for (const patch of this.patches) {
      if (patch.withinCity || patch.ward !== null || this.waterbody.includes(patch)) continue;

      const depth = patch.ringDepth;
      const inBelt = depth > 0 && depth <= this.farmRingDepth;
      // A single draw per patch keeps the outer edge ragged rather than a
      // uniform offset curve; the outermost ring is sparser than the inner.
      if (inBelt && rng.bool(depth === this.farmRingDepth ? 0.6 : 0.95)) {
        patch.zone = 'farm';
        patch.ward = new Farm(this, patch);
      } else {
        patch.ward = new Ward(this, patch);
      }
    }
  }

  /**
   * One lane per suburb cluster (a connected run of `zone === 'suburb'`
   * patches — the craftsmen ribbon beyond the wall, NOT satellites and NOT
   * farmland, which never get a lane): from the cluster's farthest-out
   * patch, back to the gate nearest the cluster, so the ribbon reads as
   * served by a road rather than backing onto nothing. Runs after zoning
   * (createWards → buildFarms), reusing the topology `buildStreets` (phase
   * 4) already built over the settled patch set — `this.patches` doesn't
   * change count between phase 4 and here, only wards/zones get assigned,
   * so that graph is still current.
   */
  private buildFaubourgLanes(): void {
    if (this.topology === null || this.adjacency === null || this.gates.length === 0) return;

    const adjacency = this.adjacency;
    const visited = new Set<Patch>();
    const clusters: Patch[][] = [];

    for (const patch of this.patches) {
      if (patch.zone !== 'suburb' || visited.has(patch)) continue;
      const cluster: Patch[] = [];
      const queue: Patch[] = [patch];
      visited.add(patch);
      while (queue.length > 0) {
        const p = queue.shift()!;
        cluster.push(p);
        for (const n of adjacency.neighboursOf(p)) {
          if (n.zone === 'suburb' && !visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
      clusters.push(cluster);
    }

    if (clusters.length === 0) return;

    let addedLane = false;
    for (const cluster of clusters) {
      let cx = 0;
      let cy = 0;
      for (const p of cluster) {
        cx += p.shape.center.x;
        cy += p.shape.center.y;
      }
      const centroid = new Point(cx / cluster.length, cy / cluster.length);

      const gate = minBy(this.gates, g => Point.distance(g, centroid));
      const farPatch = maxBy(cluster, p => Point.distance(p.shape.center, gate));
      const startVertex = minBy(farPatch.shape.vertices, v => Point.distance(v, gate));

      const lane = this.topology.buildPath(startVertex, gate, this.topology.outer);
      if (lane !== null) {
        this.streets.push(new Polygon(lane));
        addedLane = true;
      }
    }

    if (addedLane) {
      // Note: lanes land in `this.streets`, not `this.roads` —
      // `clipRoadsAtWater` only reads/writes `this.roads`, so calling it
      // here is a no-op against faubourg lanes. Deliberately not called.
      this.tidyUpRoads();
    }
  }

  // Phase 6: Build geometry
  private buildGeometry(): void {
    for (const patch of this.patches) {
      if (patch.ward && !this.waterbody.includes(patch)) {
        patch.ward.createGeometry();
      }
    }
    this.refineDensity();
    this.removeDrownedGeometry();
    this.pretrimOrdinaryCount = this.countOrdinaryBuildings();
    this.pretrimCoreOrdinaryCount = this.patches.some(p => p.zone === 'suburb' || p.zone === 'satellite')
      ? this.countCoreOrdinaryBuildings()
      : this.pretrimOrdinaryCount;
    this.applyBuildingBudget();
  }

  private countOrdinaryBuildings(): number {
    let n = 0;
    for (const patch of this.patches) {
      const ward = patch.ward;
      if (!ward || ward.type === WardType.Park || BUDGET_EXEMPT_WARD_TYPES.has(ward.type)) continue;
      n += ward.geometry.length;
    }
    return n;
  }

  /**
   * One adaptive pass toward the household target: patch geometry cannot
   * know in advance how many buildings subdivision will yield, so if the
   * first build lands under 65% of target, shrink CommonWard block size and
   * rebuild ordinary wards once. `minSqScale` is the minimum-square-area
   * scale fed to `CommonWard`'s subdivision, RELATIVE to `baseMinSqScale`
   * (not an absolute scale) — a LARGER `minSqScale` means bigger minimum
   * blocks, i.e. FEWER, larger buildings; a SMALLER one means more, smaller
   * buildings. Here `count < target` means too few buildings were produced,
   * so we scale `baseMinSqScale` down by `count/target` (floored at 0.25 of
   * baseMinSqScale, so this pass never shrinks block size by more than 4x)
   * to pack more buildings in. Deterministic — extra rng draws, fixed
   * sequence per seed. Runs before the drowning filter (target is
   * approximate on coasts).
   */
  private refineDensity(): void {
    const target = buildingBudget(this.params.population, this.params.urbanDensity);
    // The pass exists to make a settlement house its people, and
    // `applyBuildingBudget` trims everything above the budget away moments
    // later. So the SETTLEMENT's own shortfall bounds what any group pass
    // can usefully buy: refining past it produces buildings that are
    // trimmed, at the price of shrinking the ones that survive. Two
    // consequences, both new in fix round 4 (until the texture floor was
    // lifted off `baseMinSqScale` this pass was a no-op above pop ~1350, so
    // neither could bite):
    //  - a mesh already at budget skips the pass entirely, and
    //  - `shrinkBound` clamps how fine a group may go.
    // Measured at pop 50000: the cap-bound core's own ratio is 0.23 against
    // the full budget (a cap-bound core can never reach it, whatever the
    // texture), so unbounded it saturated at the floor and took the core
    // from mean building area 7.62 to 4.03 and coverage 0.70 to 0.40 —
    // buying +2 points of a census that was already at 98%.
    // Row-housed settlements only: a village's densify path is reference
    // behaviour and its output is pinned byte-for-byte.
    const rows = rowHousing(this.params.population);
    const totalYield = this.countOrdinaryBuildings();
    if (rows && totalYield >= target) return;
    const shrinkBound = rows ? totalYield / target : 0;
    // Sprawl (suburb/satellite) patches now also carry ordinary buildings
    // (CraftsmenWard/Slum) and countryside farmsteads reach much further
    // now that buildWalls keeps radius*12 instead of radius*3. Both would
    // count toward `target`'s pre-sprawl semantics — `target` and
    // `baseScaleForYield`'s calibration assumed this.patches's ordinary
    // yield WAS the walled settlement's yield. Folding sprawl's volume in
    // satisfies the >= target*0.65 gate on volume alone and starves the
    // core of the density boost it still needs (measured: core density
    // collapsed from ~21-30/patch to ~5-6/patch at pop 70000 without this
    // scoping). Scoping is conditional on sprawl actually existing so a
    // settlement with no suburb/satellite patches (population at or below
    // coreCapacity — every previously-pinned fixture) takes the exact same
    // path as before, unchanged.
    const hasSprawl = this.patches.some(p => p.zone === 'suburb' || p.zone === 'satellite');
    const isSprawl = (p: Patch): boolean => p.zone === 'suburb' || p.zone === 'satellite';
    const count = hasSprawl ? this.countCoreOrdinaryBuildings() : this.countOrdinaryBuildings();
    // ...but the core is only ever asked for ITS share of the budget when
    // sprawl exists, mirroring the sprawl pass below and the trim's own
    // split. Fix round 4: with a live floor, measuring the core's yield
    // against the WHOLE budget made it chase houses that belong outside the
    // walls — at pop 20000 (core 902 buildings against a 917 core share, so
    // not short at all) it refined the walled fabric to 40 buildings per
    // patch against a 30 target, 33% of which the budget trim then stripped
    // back out. That is exactly the sculpted-cluster defect
    // `tests/fidelity-round4.test.ts` pins. Row-housed only, like the
    // guard above: a village's pass is reference behaviour, pinned.
    const coreShareOfMesh = this.patches.filter(p => p.zone === 'core').length / this.nPatches;
    const coreTarget = hasSprawl && rows ? target * coreShareOfMesh : target;
    this.densifyGroup(p => !hasSprawl || !isSprawl(p), count, coreTarget, shrinkBound);

    // Sprawl gets the same corrective pass against its OWN share of the
    // target, for the same reason the trim in `applyBuildingBudget` splits
    // the budget: extramural patches are the LARGE outer cells of the mesh
    // (the inner ones become the core), so at base texture scale they render
    // nearly empty — measured 4-6 buildings per patch against the core's 20.
    // That was tolerable while `extramuralShare` was ~20% and the core still
    // carried the settlement; at ~38% it is not. (The 20-45% curve that
    // produced that ~38% was walked back to 10-20% by the owner decision of
    // 2026-08-09 — see `extramuralShare` — so the measurements below are the
    // history that motivated this pass, not today's share. The pass still
    // earns its keep: sprawl patches are the mesh's large outer cells
    // whatever share reaches them.) Measured at pop 4200 once
    // the share rose: 12 sprawl patches produced 55 buildings against a
    // ~187 share, and the settlement rendered at 60% of its population
    // target, below the 65% floor `refineDensity` exists to defend. The core
    // cannot make the shortfall up — its own pass is already saturated at
    // the 0.25 clamp — and it should not: those people live outside the
    // walls, so their houses belong out there.
    //
    // Scoped to CORE-DOMINATED settlements — those whose walled core is at
    // least half the mesh. That is the proxy for "the core is share-bound,
    // not capacity-bound": below `coreCapacity` the raised share is what
    // pushed the budget outside the walls, and it is those settlements that
    // render short. A cap-bound city is the other way round — its core is a
    // small fraction of the mesh (measured nCore/nPatches: 0.70 at pop 1200,
    // 0.62 at 4200, 0.55 at 20000, 0.45 at 30000, 0.27 at 50000, 0.17 at
    // 250000) and its sprawl is already dense (16 buildings per patch at pop
    // 50000, against a town's 4-6), so the pass would neither be fixing a
    // regression — city yield is byte-identical before and after the share
    // raise, since the cap governs their core either way — nor be affordable:
    // regenerating ~180 sprawl wards at a finer texture took pop 250000 from
    // 1.9 s to 5.8 s per generation, past the ~4.9 s worst case MAX_PATCHES
    // was calibrated against.
    const coreShare = coreShareOfMesh;
    if (hasSprawl && coreShare >= 0.5) {
      const sprawlTarget = target * Math.max(0, 1 - coreShare);
      this.densifyGroup(isSprawl, this.countBudgetedBuildings(this.patches.filter(isSprawl)), sprawlTarget, shrinkBound);
    }
  }

  /**
   * One corrective density pass over the patches `select` accepts: if their
   * ordinary yield `count` falls short of `target`, rebuild their common
   * wards at a proportionally smaller texture scale. See `refineDensity`.
   */
  private densifyGroup(select: (p: Patch) => boolean, count: number, target: number, shrinkBound: number = 0): void {
    if (count === 0 || target <= 0 || count >= target * 0.65) return;
    // Floor: the relative `0.25 * baseMinSqScale` was calibrated when
    // `baseScaleForYield` returned 9.0 at city texture, so a quarter of it
    // was still a coarse block. Round-cores-faubourgs task 5 fix round 3
    // re-fitted that anchor DOWN to `CITY_TEXTURE_SCALE` (house-sized lots),
    // which turned the same quarter into 0.15 — measured at pop 70000, that
    // shredded the core into 2.3-unit slivers at 0.18 coverage, because a
    // cap-bound city's core can never reach the full household target
    // however fine its texture gets (MAX_PATCHES governs, not block size),
    // so this pass saturates at its floor by construction.
    //
    // Fix round 4: that reaction over-corrected. `CITY_TEXTURE_SCALE` IS
    // `baseMinSqScale` at every population above ~1350, so the floor left
    // this pass exactly zero headroom (measured base/floor = 1.000 at pops
    // 1400/2500/4000/10000/50000) — a shortfall could not be answered at
    // all, which is what put the census at 85-94% of households instead of
    // ~100%. The floor's job is legibility, not fabric grain, so it is now
    // the measured legibility bound `DENSIFY_MIN_TEXTURE_SCALE` (see its
    // doc comment for the sweep it was read off), clamped never to exceed
    // the settlement's own base scale — a floor above the base would let
    // this pass COARSEN the fabric, which it did with a
    // `textureScaleOverride` below 0.6. Villages keep the historical
    // relative floor untouched.
    const floor = rowHousing(this.params.population)
      ? Math.min(this.baseMinSqScale, DENSIFY_MIN_TEXTURE_SCALE)
      : this.baseMinSqScale * 0.25;
    this.minSqScale = Math.max(floor, this.baseMinSqScale * Math.max(count / target, shrinkBound));
    for (const patch of this.patches) {
      if (!select(patch)) continue;
      if (patch.ward instanceof CommonWard && !this.waterbody.includes(patch)) {
        patch.ward.createGeometry();
      }
    }
    this.minSqScale = this.baseMinSqScale;
  }

  /** Ordinary-building count within the walled core only — see refineDensity's doc comment. */
  private countCoreOrdinaryBuildings(): number {
    let n = 0;
    for (const patch of this.patches) {
      if (patch.zone !== 'core') continue;
      const ward = patch.ward;
      if (!ward || ward.type === WardType.Park || BUDGET_EXEMPT_WARD_TYPES.has(ward.type)) continue;
      n += ward.geometry.length;
    }
    return n;
  }

  /**
   * Water rings for rendering and placement: the caller's vector coastline
   * when supplied, else the half-plane synthesized from `oceanBearing`,
   * else empty (landlocked).
   */
  getWaterRings(): Point[][] {
    const rings = this.params.coastlineGeometry?.filter(r => r.length >= 3) ?? [];
    if (rings.length > 0) return rings;
    return this.syntheticCoast ?? [];
  }

  /** Even-odd test against getWaterRings() — same rule as classifyWater. */
  isWaterAt(p: Point): boolean {
    let containing = 0;
    for (const ring of this.getWaterRings()) {
      if (pointInPolygon(p, ring)) containing++;
    }
    return containing % 2 === 1;
  }

  /**
   * Drop geometry that overhangs the supplied water. Patch classification is
   * centroid-based, so a "land" patch can still cross the true shoreline and
   * spill buildings into the sea. Runs before the budget trim so the budget
   * is spent on buildings that actually stand on land. Piers are exempt by
   * construction (Harbour keeps them outside ward.geometry).
   */
  private removeDrownedGeometry(): void {
    if (this.getWaterRings().length === 0) return;

    const inWater = (p: Point): boolean => this.isWaterAt(p);
    const drowned = (poly: Polygon): boolean =>
      inWater(poly.center) || poly.vertices.some(v => inWater(v));

    for (const patch of this.patches) {
      const ward = patch.ward;
      if (!ward) continue;
      if (ward.geometry.length > 0) {
        ward.geometry = ward.geometry.filter(p => !drowned(p));
      }
      if (ward instanceof Farm) {
        // subPlots and plotAngles are parallel arrays — filter both by the
        // same index set so a surviving plot keeps its own furrow angle.
        const keptPlots: Point[][] = [];
        const keptAngles: number[] = [];
        for (let i = 0; i < ward.subPlots.length; i++) {
          const plot = ward.subPlots[i];
          if (plot.some(v => inWater(v))) continue;
          keptPlots.push(plot);
          keptAngles.push(ward.plotAngles[i]);
        }
        ward.subPlots = keptPlots;
        ward.plotAngles = keptAngles;
      }
      if (ward instanceof Harbour) {
        // Piers may (and should) extend over water, but they must touch
        // land. Piers anchor to patch edges, which can sit seaward of the
        // painted shoreline (especially in oceanBearing mode) — slide those
        // to the shore; drop only true detached rafts.
        ward.piers = ward.piers.flatMap(pier => {
          const rescued = rescueDetachedPier(pier, inWater);
          return rescued ? [rescued] : [];
        });
      }
    }
  }

  /**
   * Trim ordinary buildings down to the population budget. Two policies:
   * — Small unwalled settlements (budget ≤ 40, no wall): keep the buildings
   *   closest to the town centre — hamlets read as one tight cluster.
   * — Walled or large settlements: trim each patch proportionally
   *   (largest-remainder quotas), keeping buildings nearest each patch's own
   *   centre. The wall is built around the full patch footprint in phase 3,
   *   so a global nearest-centre trim would hollow the periphery inside it
   *   (live-site defect: wall r=214 vs outermost building r=116).
   * Landmark wards and park groves are exempt; farm plots live outside
   * ward.geometry. Deterministic: sorts with coordinate tiebreaks,
   * no rng.
   */
  private applyBuildingBudget(): void {
    const budget = buildingBudget(this.params.population, this.params.urbanDensity);

    // Sprawl (suburb/satellite, plus the much larger farm ring now kept by
    // buildWalls' radius*12 cull) shares this.patches with the walled core.
    // A single global trim divides the SAME population-sized budget across
    // all of it, which — because sprawl now vastly outnumbers the core in
    // patch count — starves the core's share regardless of how well
    // refineDensity boosted it (measured: core density collapsed from
    // ~23/patch pre-trim to ~19/patch post-trim at pop 70000). Give the core
    // a budget slice sized the same way its patch count was sized
    // (nCore/nPatches — the same ratio `buildingBudget/nPatches ≈
    // perPatchDensity(population)` relationship `baseScaleForYield`'s
    // calibration relies on), and trim the rest of the budget separately
    // against everything else. No-sprawl settlements (population at or
    // below coreCapacity — every previously-pinned fixture) have zero
    // suburb/satellite patches, so this takes the single-group path,
    // unchanged from before.
    const hasSprawl = this.patches.some(p => p.zone === 'suburb' || p.zone === 'satellite');
    if (!hasSprawl) {
      this.applyBuildingBudgetToGroup(this.patches, budget);
      return;
    }

    const corePatches = this.patches.filter(p => p.zone === 'core');
    const otherPatches = this.patches.filter(p => p.zone !== 'core');
    // Same "a share is a cap, not an allocation" clamp the non-core group
    // gets below, applied to the core — a share the core cannot fill is
    // stranded exactly as the non-core group's was. It bites hardest at the
    // small end, where the core is two or three patches and every one of
    // them may be a landmark: measured at pop 60 seed 3, the core was the
    // market plus one patch (yield 0 budgeted buildings) and took 10 of a
    // 15-building budget, leaving 5 for 18 real houses outside — the
    // settlement rendered at a third of its household target. Clamping is a
    // no-op for any core that fills its share (every city: measured
    // byte-identical at pop 4200/50000/250000).
    const coreShareBudget = Math.min(
      Math.round(budget * (corePatches.length / this.nPatches)),
      this.countBudgetedBuildings(corePatches),
    );
    // The share is a SPLIT of a cap, not an allocation of buildings that
    // exist: extramural wards are sparse by design and routinely produce far
    // fewer buildings than their share of the budget. Handing them the share
    // anyway strands the difference — nobody builds it, and the settlement
    // renders below its population target. Measured at pop 4200 once
    // `extramuralShare` rose to ~38% (a curve since walked back to 10-20%,
    // see that function — the measurement is the history that motivated this
    // clamp, not today's share): the non-core group was given 187 of a
    // 487 budget and produced 78, while the core was trimmed from its natural
    // 393 down to its 300 share, for a total of 292 (60% of target, against a
    // 65% floor). Give the non-core group only what it can actually use and
    // let the core keep the slack; a group that fills its share is capped
    // exactly as before, so no settlement whose sprawl is productive (every
    // city — measured unchanged at pop 50000 and 250000) moves at all.
    const otherBudget = Math.min(
      Math.max(0, budget - coreShareBudget),
      this.countBudgetedBuildings(otherPatches),
    );
    this.applyBuildingBudgetToGroup(corePatches, budget - otherBudget);
    this.applyBuildingBudgetToGroup(otherPatches, otherBudget);
  }

  /**
   * Buildings in `patches` that count against the population budget — the
   * same predicate `applyBuildingBudgetToGroup` trims by, so a group's
   * measured yield and the budget it is handed are in the same units.
   */
  private countBudgetedBuildings(patches: Patch[]): number {
    let total = 0;
    for (const patch of patches) {
      if (!patch.ward || !isBudgetedWard(patch.ward)) continue;
      total += patch.ward.geometry.length;
    }
    return total;
  }

  /**
   * Trim ordinary buildings in `patches` down to `budget`. Two policies:
   * — Small unwalled settlements (budget ≤ 40, no wall): keep the buildings
   *   closest to the town centre — hamlets read as one tight cluster.
   * — Walled or large settlements: trim each patch proportionally
   *   (largest-remainder quotas), keeping buildings nearest each patch's own
   *   centre. The wall is built around the full patch footprint in phase 3,
   *   so a global nearest-centre trim would hollow the periphery inside it
   *   (live-site defect: wall r=214 vs outermost building r=116).
   * Landmark wards and park groves are exempt; farm plots live outside
   * ward.geometry. Deterministic: sorts with coordinate tiebreaks,
   * no rng.
   */
  private applyBuildingBudgetToGroup(patches: Patch[], budget: number): void {
    const perPatch: Array<{ ward: Ward; count: number }> = [];
    let total = 0;
    for (const patch of patches) {
      if (!patch.ward || !isBudgetedWard(patch.ward) || patch.ward.geometry.length === 0) continue;
      perPatch.push({ ward: patch.ward, count: patch.ward.geometry.length });
      total += patch.ward.geometry.length;
    }
    if (total <= budget) return;

    if (this.wall === null && budget <= HAMLET_TRIM_MAX_BUDGET) {
      // Hamlet policy: global nearest-centre (Plan A behavior, byte-stable).
      const entries: Array<{ poly: Polygon; dist: number }> = [];
      for (const { ward } of perPatch) {
        for (const poly of ward.geometry) {
          entries.push({ poly, dist: Point.distance(poly.center, this.center) });
        }
      }
      entries.sort((a, b) =>
        a.dist - b.dist ||
        a.poly.center.x - b.poly.center.x ||
        a.poly.center.y - b.poly.center.y,
      );
      const keep = new Set(entries.slice(0, budget).map(e => e.poly));
      for (const { ward } of perPatch) {
        ward.geometry = ward.geometry.filter(p => keep.has(p));
      }
      return;
    }

    // Proportional policy: quota per patch by largest remainder.
    const scale = budget / total;
    const quotas = perPatch.map(e => Math.floor(e.count * scale));
    let assigned = quotas.reduce((a, b) => a + b, 0);
    const byRemainder = perPatch
      .map((e, i) => ({ i, frac: e.count * scale - quotas[i] }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; assigned < budget && k < byRemainder.length; k++, assigned++) {
      quotas[byRemainder[k].i]++;
    }

    for (let i = 0; i < perPatch.length; i++) {
      const { ward } = perPatch[i];
      if (quotas[i] >= ward.geometry.length) continue;
      const centre = ward.patch.shape.center;
      const keep = new Set(
        ward.geometry
          .map(poly => ({ poly, d: Point.distance(poly.center, centre) }))
          .sort((a, b) =>
            a.d - b.d ||
            a.poly.center.x - b.poly.center.x ||
            a.poly.center.y - b.poly.center.y,
          )
          .slice(0, quotas[i])
          .map(e => e.poly),
      );
      ward.geometry = ward.geometry.filter(p => keep.has(p));
    }
  }

  // Public helpers
  findCircumference(patches: Patch[]): Polygon {
    if (patches.length === 0) return new Polygon();
    if (patches.length === 1) return new Polygon(patches[0].shape.vertices);

    const A: Point[] = [];
    const B: Point[] = [];

    for (const w1 of patches) {
      w1.shape.forEdge((a, b) => {
        let outerEdge = true;
        for (const w2 of patches) {
          if (w2.shape.findEdge(b, a) !== -1) {
            outerEdge = false;
            break;
          }
        }
        if (outerEdge) {
          A.push(a);
          B.push(b);
        }
      });
    }

    const result = new Polygon();
    let index = 0;
    do {
      result.push(A[index]);
      index = A.indexOf(B[index]);
      // The outer-edge walk can, rarely, land on a cycle that never revisits
      // index 0 (a spurious inner loop instead of the true boundary) — an
      // `indexOf` miss (-1) or a walk longer than the edge pool it's drawn
      // from both prove that. Left unchecked, `index === -1` sends the next
      // iteration's `A[index]` to `A[A.length - 1]` instead of throwing,
      // which can re-enter the same bad cycle and grow `result` without
      // bound (observed: 11.2s inside this loop ending in `RangeError:
      // Invalid array length`). Throwing routes into the existing
      // retry/degrade ladder in `generate()`/`probeWallRadius()`, exactly
      // like the enclosure check below.
      if (index === -1 || result.vertices.length > A.length) {
        throw new Error('Bad circumference walk!');
      }
    } while (index !== 0);

    return result;
  }

  patchByVertex(v: Point): Patch[] {
    return this.patches.filter(patch => patch.shape.contains(v));
  }

  getNeighbour(patch: Patch, v: Point): Patch | null {
    const next = patch.shape.next(v);
    for (const p of this.patches) {
      if (p.shape.findEdge(next, v) !== -1) return p;
    }
    return null;
  }

  getNeighbours(patch: Patch): Patch[] {
    return this.patches.filter(p => p !== patch && p.shape.borders(patch.shape));
  }

  isEnclosed(patch: Patch): boolean {
    return patch.withinCity && (
      patch.withinWalls ||
      this.getNeighbours(patch).every(p => p.withinCity)
    );
  }
}
