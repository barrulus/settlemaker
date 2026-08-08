import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { Segment } from '../geom/segment.js';
import { Voronoi } from '../geom/voronoi.js';
import { SeededRandom } from '../utils/random.js';
import { sign } from '../utils/math-utils.js';
import { minBy, randomElement, last } from '../utils/array-utils.js';

import { Patch } from './patch.js';
import { CurtainWall } from './curtain-wall.js';
import { Topology } from './topology.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import type { GenerationParams, DegradedFlag } from './generation-params.js';
import { densityCurve, perPatchDensity, baseScaleForYield } from './generation-params.js';
import { WardType } from '../types/interfaces.js';
import type { Street } from '../types/interfaces.js';

import { createShapeField, type ShapeField } from './shape-field.js';
import { buildAdjacency, type PatchAdjacency } from './adjacency.js';
import { assignSprawl } from './zoning.js';
import type { UrbanisationField } from './urbanisation.js';

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
const MIN_POPULATION_FOR_WALLS = 150;

/** Voronoi points per requested patch. Countryside ring (farms/wilderness)
 * comes from the surplus. Scaled down for large meshes per round-4 Task 2
 * calibration (see task-2-report.md): at nPatches ≤ 60 the 8x multiplier is
 * unchanged (small/medium settlements untouched); above that it tapers
 * toward a floor of 4x so the Voronoi build cost (which scales with the
 * number of points, not just nPatches) stays bounded for the largest
 * footprints admitted by MAX_PATCHES. */
const VORONOI_POINT_MULTIPLIER = (nPatches: number): number =>
  nPatches <= 60 ? 8 : Math.max(4, Math.round(480 / nPatches) + 3);

/** Ward types whose buildings are feature landmarks, exempt from the population budget. */
const BUDGET_EXEMPT_WARD_TYPES = new Set<WardType>([
  WardType.Castle,
  WardType.Cathedral,
  WardType.Market,
  WardType.Harbour,
]);

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

  /** Direction-dependent radial scale; warps core selection away from a disc. */
  shapeField: ShapeField | null = null;
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
    this.topology = null;
    this.syntheticCoast = null;
    this.minSqScale = this.baseMinSqScale;
    this.pretrimOrdinaryCount = 0;
    this.pretrimCoreOrdinaryCount = 0;
  }

  private build(): void {
    this.streets = [];
    this.roads = [];

    this.buildPatches();
    this.optimizeJunctions();
    this.buildWalls();
    this.classifyWater();
    this.placeHarbour();
    this.buildStreets();
    this.createWards();
    this.buildGeometry();
  }

  // Phase 1: Build Voronoi patches
  private buildPatches(): void {
    const rng = this.rng;
    const sa = rng.float() * 2 * Math.PI;
    const points: Point[] = [];
    for (let i = 0; i < this.nPatches * VORONOI_POINT_MULTIPLIER(this.nPatches); i++) {
      const a = sa + Math.sqrt(i) * 5;
      const r = i === 0 ? 0 : 10 + i * (2 + rng.float());
      points.push(new Point(Math.cos(a) * r, Math.sin(a) * r));
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

    // Estimated core radius from the spiral seeding (r ≈ 10 + i·2.5), used
    // only to probe water at a plausible distance.
    const probeRadius = 10 + this.nCore * 2.5;
    this.shapeField = createShapeField({
      roadDirections: (this.params.roadEntryPoints ?? []).map(r => r.point),
      probeRadius,
      ...(this.getWaterRings().length > 0 ? { isWaterAt: (p: Point) => this.isWaterAt(p) } : {}),
      rng,
    });
    const field = this.shapeField;

    // Decorate-sort-undecorate: scaleAt (road-loop + harmonics + up to two
    // point-in-polygon water probes) is computed once per point instead of
    // twice per comparison. At pop 200000 (~44k points) a naive comparator
    // reran it ~2*n*log2(n) times per buildPatches call, and buildPatches
    // reruns on every retry in the generate() ladder.
    const decorated = voronoi.points.map((p): [Point, number] => {
      // Distance warped by the shape field: small = "belongs in the core".
      const warped = p.length / field.scaleAt(Math.atan2(p.y, p.x));
      return [p, warped];
    });
    decorated.sort((a, b) => sign(a[1] - b[1]));
    voronoi.points = decorated.map(([p]) => p);
    const regions = voronoi.partitioning();

    this.patches = [];
    this.inner = [];

    let count = 0;
    for (const r of regions) {
      const patch = Patch.fromRegion(r);
      this.patches.push(patch);

      if (count === 0) {
        // Find vertex closest to origin for center
        this.center = minBy(patch.shape.vertices, (p: Point) => p.length);
        if (this.plazaNeeded) {
          this.plaza = patch;
        }
      } else if (count === this.nCore && this.citadelNeeded) {
        this.citadel = patch;
        this.citadel.withinCity = true;
      }

      if (count < this.nCore) {
        patch.withinCity = true;
        patch.withinWalls = this.wallsNeeded;
        this.inner.push(patch);
      }

      count++;
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
      for (const p of this.inner) {
        for (const n of adj.neighboursOf(p)) {
          // Exclude the citadel explicitly (it sits at sorted index nCore —
          // the single nearest unselected patch — so it is very often the
          // top-up's nearest-centre pick) and, defensively, any patch that
          // already has a ward assigned. Absorbing the citadel into `inner`
          // would make createWards overwrite its Castle with an ordinary
          // ward while buildWalls's castle gates and this.citadel both still
          // point at it — a silent "citadel present but no Castle" defect.
          if (n === this.citadel) continue;
          if (n.ward !== null) continue;
          if (!connected.has(n)) candidates.add(n);
        }
      }
      if (candidates.size === 0) break;
      const best = minBy([...candidates], (p: Patch) => p.shape.center.length);
      connected.add(best);
      best.withinCity = true;
      best.withinWalls = this.wallsNeeded;
      this.inner.push(best);
    }
  }

  // Phase 2: Merge close junctions
  private optimizeJunctions(): void {
    const patchesToOptimize = this.citadel === null
      ? this.inner
      : this.inner.concat([this.citadel]);

    const wards2clean: Patch[] = [];
    for (const w of patchesToOptimize) {
      let index = 0;
      while (index < w.shape.length) {
        const v0 = w.shape.vertices[index];
        const v1 = w.shape.vertices[(index + 1) % w.shape.length];

        if (v0 !== v1 && Point.distance(v0, v1) < 8) {
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

  // Phase 3.5: Classify water patches for port cities
  private classifyWater(): void {
    const coast = this.params.coastlineGeometry;
    const hasCoast = coast != null && coast.length > 0 && coast.some(p => p.length >= 3);
    const hasBearing = this.params.oceanBearing != null;
    if (!hasCoast && !hasBearing) return;

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
      // Synthesize an organic coastline from the bearing, then classify
      // against it exactly like a caller-supplied ring — one water
      // definition for placement, drowning, road clipping, AND painting.
      // Wobble phases derive from the seed arithmetically so the rng
      // stream is untouched (bearing burgs keep their layouts per seed).
      const rad = this.params.oceanBearing! * Math.PI / 180;
      const oceanDirX = Math.sin(rad);
      const oceanDirY = -Math.cos(rad);
      const radius = this.border!.getRadius();
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
      isWater = (patch) => this.isWaterAt(patch.shape.center);
    }

    for (const patch of this.patches) {
      if (patch.withinCity) continue;
      if (patch.ward !== null) continue;
      if (isWater(patch)) this.waterbody.push(patch);
    }

    // Mark wall segments facing water as inactive
    if (this.wall !== null && this.waterbody.length > 0) {
      this.wall.markWaterfrontSegments(this.waterbody);
      // Rebuild towers since segments changed
      this.wall.buildTowers();
    }

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
      if (harbourGate && !this.gates.includes(harbourGate)) {
        this.gates.push(harbourGate);
        // Tag it so the GeoJSON output can render it as a harbour-kind gate.
        const vertexIndex = wallVerts.indexOf(harbourGate);
        const bearingDeg = ((Math.atan2(harbourGate.x, -harbourGate.y) * 180 / Math.PI) % 360 + 360) % 360;
        const normalisedBearing = Math.round(bearingDeg * 10) / 10;
        this.border.gateMeta.set(harbourGate, {
          wallVertexIndex: vertexIndex,
          bearingDeg: normalisedBearing,
          kind: 'sea',
          routes: [{
            kind: 'sea',
            requestedBearingDeg: normalisedBearing,
            matchDeltaDeg: 0,
          }],
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

    for (const gate of this.gates) {
      const end = this.plaza !== null
        ? minBy(this.plaza.shape.vertices, v => Point.distance(v, gate))
        : this.center;

      const street = this.topology.buildPath(gate, end, this.topology.outer);
      if (street !== null) {
        this.streets.push(new Polygon(street));

        if (this.border!.gates.includes(gate)) {
          const hasRoute = (this.border!.gateMeta.get(gate)?.routes.length ?? 0) > 0;
          if (!routeAware || hasRoute) {
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

    this.clipRoadsAtWater();
    this.tidyUpRoads();

    for (const a of this.arteries) {
      smoothStreet(a);
    }
  }

  /**
   * Truncate external roads at the waterline: keep only the contiguous dry
   * tail ending at the gate, dropping the road entirely if fewer than two
   * dry vertices remain. Cheap placeholder for shore-aware routing — a road
   * simply stops at the coast instead of walking on the sea. Runs before
   * tidyUpRoads so arteries inherit the clipped geometry.
   */
  private clipRoadsAtWater(): void {
    if (this.getWaterRings().length === 0) return;
    this.roads = this.roads.flatMap(road => {
      let lastWet = -1;
      road.vertices.forEach((v, i) => {
        if (this.isWaterAt(v)) lastWet = i;
      });
      if (lastWet === -1) return [road];
      const dryTail = road.vertices.slice(lastWet + 1);
      return dryTail.length >= 2 ? [new Polygon(dryTail)] : [];
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

        // Skip segments along the plaza
        if (this.plaza !== null &&
            this.plaza.shape.contains(v0) &&
            this.plaza.shape.contains(v1)) {
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

    this.urbanisationField = assignSprawl({
      patches: this.patches,
      inner: this.inner,
      adjacency: this.adjacency!,
      roadDirections: (this.params.roadEntryPoints ?? []).map(r => r.point),
      coreRadius: this.border!.getRadius(),
      population: this.params.population,
      isBuildable: (p) => p.ward === null && !this.waterbody.includes(p) && !this.isWaterAt(p.shape.center),
      budget: Math.max(0, this.nPatches - this.inner.length),
    });

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
      for (const gate of this.wall.gates) {
        if (!rng.bool(1 / Math.max(2, this.nCore - 5))) {
          for (const patch of this.patchByVertex(gate)) {
            if (patch.ward === null) {
              patch.withinCity = true;
              patch.ward = new GateWard(this, patch);
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
  }

  /**
   * Assign countryside patches as Farm or wilderness using a sinusoidal boundary.
   * Port of watabou's buildFarms — uses a*sin(θ+c) + b*sin(2θ+d) to create
   * an organic farm/wilderness boundary around the city.
   */
  private buildFarms(): void {
    const rng = this.rng;

    // Random wave parameters (a uses normal-ish 3-sample average × 2)
    const a = rng.normal() * 2;
    const b = rng.normal();
    const c = rng.float() * Math.PI * 2;
    const d = rng.float() * Math.PI * 2;

    // Calculate city radius from inner patches
    this.cityRadius = 0;
    for (const patch of this.patches) {
      if (patch.withinCity) {
        for (const v of patch.shape.vertices) {
          this.cityRadius = Math.max(this.cityRadius, v.length);
        }
      }
    }

    // Assign countryside wards using sinusoidal boundary
    for (const patch of this.patches) {
      if (patch.withinCity || patch.ward !== null || this.waterbody.includes(patch)) continue;

      const center = patch.shape.center;
      const dir = center.subtract(this.center);
      const angle = Math.atan2(dir.y, dir.x);
      const waveRadius = a * Math.sin(angle + c) + b * Math.sin(2 * angle + d);

      if (dir.length < (waveRadius + 1) * this.cityRadius) {
        patch.ward = new Farm(this, patch);
      } else {
        patch.ward = new Ward(this, patch);
      }
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
    const count = hasSprawl ? this.countCoreOrdinaryBuildings() : this.countOrdinaryBuildings();
    if (count === 0 || count >= target * 0.65) return;

    this.minSqScale = this.baseMinSqScale * Math.max(0.25, count / target);
    for (const patch of this.patches) {
      if (hasSprawl && (patch.zone === 'suburb' || patch.zone === 'satellite')) continue;
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
    const coreBudget = Math.round(budget * (corePatches.length / this.nPatches));
    this.applyBuildingBudgetToGroup(corePatches, coreBudget);
    this.applyBuildingBudgetToGroup(otherPatches, Math.max(0, budget - coreBudget));
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
    const isBudgeted = (ward: Ward): boolean =>
      ward.type !== WardType.Park && !BUDGET_EXEMPT_WARD_TYPES.has(ward.type);

    const perPatch: Array<{ ward: Ward; count: number }> = [];
    let total = 0;
    for (const patch of patches) {
      if (!patch.ward || !isBudgeted(patch.ward) || patch.ward.geometry.length === 0) continue;
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
