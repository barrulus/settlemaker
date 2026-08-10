import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { SeededRandom } from '../utils/random.js';
import { WardType } from '../types/interfaces.js';
import { bisect } from '../geom/cutter.js';
import { interpolate, scalar, distance2line } from '../geom/geom-utils.js';
import { minBy } from '../utils/array-utils.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';
import { edgeInsetScale, rowHousing, ROW_OUTSKIRTS_BITE } from '../generator/generation-params.js';

/**
 * Largest built-up area, in city patches, that `filterOutskirts` treats as
 * having no interior to thin toward — see the guards in that method.
 *
 * Read off two sweeps. City-patch count is a step function of population and
 * barely varies with seed: 3 up to pop 100, 4 at 140, 5 at 150, 6 at 200, 9
 * at 300, 12 at 400, ~20 by 1000. Independently, "does this settlement
 * contain an INTERIOR patch" (one whose every vertex is shared only with
 * other city patches — exactly the vertices `filterOutskirts`' density field
 * counts as populated) is NO at every seed up to pop 200, mixed at 300, and
 * YES at every seed from 400 up. The two agree that a settlement of six
 * patches or fewer has no interior, which is why the bound is a patch count
 * and not a population. It stops short of pop 300 deliberately: the two
 * pop-300 seeds that lack an interior patch still render 71-100% of their
 * households, so the guards would buy nothing there and would move a render
 * gated and approved as it stands.
 */
export const INTERIORLESS_CITY_PATCHES = 6;

export const MAIN_STREET = 2.0;
export const REGULAR_STREET = 1.0;
export const ALLEY = 0.6;

export class Ward {
  model: Model;
  patch: Patch;
  geometry: Polygon[] = [];
  type: WardType = WardType.Empty;

  constructor(model: Model, patch: Patch) {
    this.model = model;
    this.patch = patch;
  }

  get rng(): SeededRandom {
    return this.model.rng;
  }

  /**
   * Multiplier on `MAIN_STREET`/`REGULAR_STREET`/`ALLEY` for this ward's
   * settlement population -- see `edgeInsetScale`'s doc comment. 1.0 for
   * villages (today's widths, unchanged); shrinks toward the legibility
   * floor as population climbs toward the core-capacity default.
   */
  get insetScale(): number {
    return edgeInsetScale(this.model.params.population);
  }

  createGeometry(): void {
    this.geometry = [];
  }

  getCityBlock(): Polygon {
    const insetDist: number[] = [];
    const innerPatch = this.model.wall === null || this.patch.withinWalls;
    const scale = this.insetScale;

    this.patch.shape.forEdge((v0, v1) => {
      if (this.model.wall !== null && this.model.wall.bordersBy(this.patch, v0, v1)) {
        insetDist.push(MAIN_STREET * scale / 2);
      } else {
        let onStreet = innerPatch && (this.model.plaza !== null &&
          this.model.plaza.shape.findEdge(v1, v0) !== -1);
        if (!onStreet) {
          for (const street of this.model.arteries) {
            if (street.contains(v0) && street.contains(v1)) {
              onStreet = true;
              break;
            }
          }
        }
        insetDist.push((onStreet ? MAIN_STREET : (innerPatch ? REGULAR_STREET : ALLEY)) * scale / 2);
      }
    });

    return this.patch.shape.isConvex()
      ? this.patch.shape.shrink(insetDist)
      : this.patch.shape.buffer(insetDist);
  }

  filterOutskirts(): void {
    // How hard the outskirts thinning bites. 1.0 is the reference
    // behaviour and stays for villages, where a ragged, thinning edge IS
    // the look. A row-housed settlement is contiguous fabric by
    // construction, and this filter runs on EVERY patch of an unwalled
    // town (nothing is `isEnclosed` without a wall), so at full strength it
    // shredded ~40% of a town's houses -- measured at the pop-1200 unwalled
    // case `tests/density-target.test.ts` exercises: 103 core buildings
    // against a 121 floor, with no budget trim involved at all. Softening
    // it keeps the rows reading as rows at the edge and returns the census.
    const bite = rowHousing(this.model.params.population)
      ? ROW_OUTSKIRTS_BITE
      : 1.0;
    const populatedEdges: Array<{
      x: number; y: number; dx: number; dy: number; d: number;
    }> = [];

    const addEdge = (v1: Point, v2: Point, factor: number = 1.0) => {
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const distances = new Map<Point, number>();
      const farthest = minBy(this.patch.shape.vertices, (v: Point) => {
        const dist = (v !== v1 && v !== v2)
          ? distance2line(v1.x, v1.y, dx, dy, v.x, v.y)
          : 0;
        const val = dist * factor;
        distances.set(v, val);
        return -val; // minBy with negative = maxBy
      });
      populatedEdges.push({ x: v1.x, y: v1.y, dx, dy, d: distances.get(farthest)! });
    };

    this.patch.shape.forEdge((v1, v2) => {
      let onRoad = false;
      for (const street of this.model.arteries) {
        if (street.contains(v1) && street.contains(v2)) {
          onRoad = true;
          break;
        }
      }

      if (onRoad) {
        addEdge(v1, v2, 1);
      } else {
        const n = this.model.getNeighbour(this.patch, v1);
        if (n !== null) {
          if (n.withinCity) {
            addEdge(v1, v2, this.model.isEnclosed(n) ? 1 : 0.4);
          }
        }
      }
    });

    // Density per vertex
    const density = this.patch.shape.vertices.map(v => {
      if (this.model.gates.includes(v)) return 1;
      return this.model.patchByVertex(v).every(p => p.withinCity)
        ? 2 * this.rng.float()
        : 0;
    });

    // The thinning is RELATIVE: `minDist` is divided by the interpolated
    // vertex density `p` below. A vertex reads 0 unless every patch meeting
    // it is a city patch, so on a settlement only a few patches across `p`
    // is near zero everywhere and `minDist / p` overshoots the roll for the
    // WHOLE ward — the filter stops thinning an outskirt and demolishes the
    // settlement. Measured at pop 60: the gate ward subdivided into 13
    // buildings and the craftsmen ward into 15, and this filter deleted all
    // 28; the hamlet rendered as bare fields. Below pop ~100 that was every
    // seed (a 175-case sweep found 6 settlements with no house at all).
    //
    // Scoped to settlements with no interior to thin toward — see
    // `INTERIORLESS_CITY_PATCHES` for the two sweeps that bound sets. Larger
    // settlements keep the reference behaviour byte-for-byte: their ragged,
    // thinning edge IS the look, and it is the look approved at five render
    // gates.
    const noInterior = this.model.patches.filter(p => p.withinCity).length
      <= INTERIORLESS_CITY_PATCHES;

    // With no populated vertex at all there is no gradient to thin along, so
    // the filter has nothing to say and keeps what subdivision produced; the
    // household budget in `applyBuildingBudget` still caps the count. The
    // rng draw below is taken either way, so wards that DO thin are
    // bit-identical to before.
    const noGradient = noInterior && density.every(d => d <= 0);

    // Drop scores, kept so the floor below can name the most interior
    // building without re-deriving (or re-drawing) anything.
    const scores = new Map<Polygon, number>();
    const before = this.geometry;

    this.geometry = this.geometry.filter(building => {
      let minDist = 1.0;
      for (const edge of populatedEdges) {
        for (const v of building.vertices) {
          const d = distance2line(edge.x, edge.y, edge.dx, edge.dy, v.x, v.y);
          const dist = d / edge.d;
          if (dist < minDist) minDist = dist;
        }
      }

      const c = building.center;
      const interp = this.patch.shape.interpolate(c);
      let p = 0;
      for (let j = 0; j < interp.length; j++) {
        p += density[j] * interp[j];
      }
      minDist /= p;

      scores.set(building, minDist * bite);
      const roll = this.rng.fuzzy(1);
      return noGradient || roll > minDist * bite;
    });

    // Floor: this filter THINS the outskirts, it does not unbuild a ward the
    // model decided to populate. A weak gradient can still take every
    // building — a hamlet's interior is one or two shared vertices, so `p`
    // is small everywhere and `minDist / p` overshoots the roll for the whole
    // ward (measured at pop 60 seed 20: two craftsmen wards subdivided into
    // 2 and 5 buildings and kept none, so the settlement had no houses at
    // all). Keep the single most interior building in that case. Scoped like
    // `noGradient` above, and it only fires where the ward would otherwise
    // render empty, so no ward that keeps anything today moves and no rng
    // draw is added.
    if (noInterior && this.geometry.length === 0 && before.length > 0) {
      let best = before[0];
      for (const b of before) {
        const s = scores.get(b)!;
        const bs = scores.get(best)!;
        if (s < bs || (s === bs && (b.center.x - best.center.x || b.center.y - best.center.y) < 0)) {
          best = b;
        }
      }
      this.geometry = [best];
    }
  }

  getLabel(): string | null {
    return null;
  }

  static rateLocation(_model: Model, _patch: Patch): number {
    return 0;
  }
}

/**
 * Convert an irregular polygon to the largest inscribed rectangle aligned to its dominant edge.
 * Returns null when no valid rectangle can be fit (polygon is too degenerate to salvage).
 */
function rectangularize(poly: Polygon): Polygon | null {
  if (poly.length < 4) return null;

  // Find longest edge direction (dominant axis)
  let longestLen = -1;
  let dx = 0, dy = 0;
  poly.forEdge((v0, v1) => {
    const len = Point.distance(v0, v1);
    if (len > longestLen) {
      longestLen = len;
      dx = v1.x - v0.x;
      dy = v1.y - v0.y;
    }
  });
  if (longestLen <= 0) return null;

  // Normalized along-axis and perpendicular
  const ax = dx / longestLen;
  const ay = dy / longestLen;
  const px = -ay;
  const py = ax;

  const c = poly.centroid;

  // For each edge, compute a linear constraint on the rectangle half-widths (hw, hh):
  //   a_i * hw + b_i * hh <= d_i
  // where d_i is perpendicular distance from centroid to edge line,
  // and a_i, b_i are projections of the edge normal onto the two axes.
  const constraints: Array<{ a: number; b: number; d: number }> = [];
  poly.forEdge((v0, v1) => {
    const ex = v1.x - v0.x;
    const ey = v1.y - v0.y;
    const eLen = Math.sqrt(ex * ex + ey * ey);
    if (eLen <= 0) return;

    // Perpendicular distance from centroid to edge line
    const dist = Math.abs((c.x - v0.x) * ey - (c.y - v0.y) * ex) / eLen;
    if (dist <= 0) return;

    // Edge normal (direction doesn't matter since we use abs projections)
    const nx = ey / eLen;
    const ny = -ex / eLen;

    constraints.push({
      a: Math.abs(nx * ax + ny * ay),
      b: Math.abs(nx * px + ny * py),
      d: dist,
    });
  });

  if (constraints.length < 2) return null;

  // Find optimal hw, hh by checking intersections of all constraint pairs
  let bestArea = 0;
  let bestHw = 0, bestHh = 0;

  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      const { a: ai, b: bi, d: di } = constraints[i];
      const { a: aj, b: bj, d: dj } = constraints[j];
      const det = ai * bj - aj * bi;
      if (Math.abs(det) < 1e-10) continue;

      const hw = (di * bj - dj * bi) / det;
      const hh = (dj * ai - di * aj) / det;
      if (hw <= 0 || hh <= 0) continue;

      // Verify all constraints are satisfied
      let valid = true;
      for (const { a, b, d } of constraints) {
        if (a * hw + b * hh > d + 1e-10) { valid = false; break; }
      }
      if (!valid) continue;

      const area = hw * hh;
      if (area > bestArea) {
        bestArea = area;
        bestHw = hw;
        bestHh = hh;
      }
    }
  }

  if (bestArea <= 0) return null;

  // Build rectangle centered on centroid
  const corners = [
    new Point(c.x - bestHw * ax - bestHh * px, c.y - bestHw * ay - bestHh * py),
    new Point(c.x + bestHw * ax - bestHh * px, c.y + bestHw * ay - bestHh * py),
    new Point(c.x + bestHw * ax + bestHh * px, c.y + bestHw * ay + bestHh * py),
    new Point(c.x - bestHw * ax + bestHh * px, c.y - bestHw * ay + bestHh * py),
  ];

  // Ensure CCW winding (positive signed area)
  const rect = new Polygon(corners);
  if (rect.square < 0) corners.reverse();

  return new Polygon(corners);
}

/**
 * Check if a polygon is unsuitable as a building footprint — too few sides, a thin
 * wedge, or irregular enough that it wouldn't read as a rectangle.
 *
 * Why: 4+ vertices alone isn't enough — a near-collinear 4-gon still looks triangular.
 * Edge-ratio catches wedges; compactness catches irregular 5+ vertex slivers.
 */
function isDegenerate(p: Polygon): boolean {
  if (p.length < 4) return true;

  let minEdge = Infinity;
  let maxEdge = 0;
  p.forEdge((v0, v1) => {
    const len = Point.distance(v0, v1);
    if (len < minEdge) minEdge = len;
    if (len > maxEdge) maxEdge = len;
  });
  if (maxEdge <= 0 || minEdge / maxEdge < 0.15) return true;

  // Compactness = 4π·area/perimeter². Square ≈ 0.79, 1:5 rect ≈ 0.44, 1:8 rect ≈ 0.31.
  // 0.3 threshold drops very elongated or irregular shapes but keeps ordinary rectangles.
  return p.compactness < 0.3;
}

/**
 * Recursive alley-based building subdivision.
 *
 * `fillLots` selects the leaf policy — see `tryEmitBuilding`. Default
 * `false` keeps the historical detached-rectangle leaf (villages, harbour
 * warehouses); `true` is the watabou-faithful row-housing leaf.
 */
export function createAlleys(
  p: Polygon,
  rng: SeededRandom,
  minSq: number,
  gridChaos: number,
  sizeChaos: number,
  emptyProb: number = 0.04,
  split: boolean = true,
  alleyWidth: number = ALLEY,
  fillLots: boolean = false,
  maxLotSq: number = Infinity,
): Polygon[] {
  // Find longest edge
  let v: Point | null = null;
  let maxLength = -1;
  p.forEdge((p0, p1) => {
    const len = Point.distance(p0, p1);
    if (len > maxLength) {
      maxLength = len;
      v = p0;
    }
  });

  const spread = 0.8 * gridChaos;
  const ratio = (1 - spread) / 2 + rng.float() * spread;

  const angleSpread = (Math.PI / 6) * gridChaos * (p.square < minSq * 4 ? 0 : 1);
  const b = (rng.float() - 0.5) * angleSpread;

  const halves = bisect(p, v!, ratio, b, split ? alleyWidth : 0);
  const buildings: Polygon[] = [];

  // Bisect returns a single polygon when it couldn't find two edge intersections —
  // recursing would loop on the same shape, so treat the input as a terminal leaf.
  if (halves.length === 1) {
    // Copy: with `fillLots` the leaf pushes the polygon it was handed
    // straight into `buildings`, and on this path that polygon is the
    // CALLER's (at the top of the recursion, `CommonWard`'s own block), so
    // emitting it directly would alias ward geometry onto ward shape. The
    // vertices are shared, only the polygon wrapper is fresh — enough to
    // keep the two objects independent, and numerically identical output.
    tryEmitBuilding(new Polygon(p.copy()), rng, emptyProb, buildings, fillLots);
    return buildings;
  }

  for (const half of halves) {
    if (half.square < Math.min(maxLotSq, minSq * Math.pow(2, 4 * sizeChaos * (rng.float() - 0.5)))) {
      tryEmitBuilding(half, rng, emptyProb, buildings, fillLots);
    } else {
      buildings.push(
        ...createAlleys(
          half, rng, minSq, gridChaos, sizeChaos, emptyProb,
          half.square > minSq / (rng.float() * rng.float()),
          alleyWidth, fillLots, maxLotSq,
        ),
      );
    }
  }

  return buildings;
}

/**
 * Emit one lot as a building, or drop it.
 *
 * Two leaf policies:
 *
 * - `fillLots === false` (villages, harbour warehouses): the historical
 *   port behaviour — replace the lot with its largest inscribed rectangle.
 *   That rectangle is centred on the lot's centroid, so the building pulls
 *   away from every lot edge: measured over the walled core at pop
 *   1200/4000/10000 it keeps only ~62% of the lot's area, and the ~11% of
 *   lots whose rectangle comes back null or degenerate vanish entirely.
 *   The result reads as detached units with random gaps — right for an airy
 *   hamlet, wrong for a town.
 *
 * - `fillLots === true` (towns and cities): emit the lot itself, which is
 *   what the Haxe reference's `Ward.createAlleys` leaf does — it pushes the
 *   bisected half straight into `buildings`, with no rectangle step at all
 *   (the reference tree is not vendored in this checkout, so this is stated
 *   from the port's own divergence, measured above, not a file diff).
 *   `bisect` already carved
 *   `alleyWidth` out between siblings, so neighbouring lots share a lane of
 *   precisely one alley — buildings line up into contiguous rows the way
 *   watabou's do. `rectangularize` stays on as a SALVAGE for lots that are
 *   genuinely unusable as footprints (thin wedges, near-collinear 4-gons),
 *   so the shape filter this port added is kept where it earns its keep
 *   instead of being paid on every lot.
 */
function tryEmitBuilding(
  poly: Polygon,
  rng: SeededRandom,
  emptyProb: number,
  out: Polygon[],
  fillLots: boolean = false,
): void {
  if (rng.bool(emptyProb)) return;
  if (fillLots && !isDegenerate(poly)) {
    out.push(poly);
    return;
  }
  const rect = rectangularize(poly);
  if (rect === null || isDegenerate(rect)) return;
  out.push(rect);
}

/** Orthogonal building subdivision */
export function createOrthoBuilding(
  poly: Polygon,
  rng: SeededRandom,
  minBlockSq: number,
  fill: number,
): Polygon[] {
  function findLongestEdge(p: Polygon): Point {
    return minBy(p.vertices, v => -p.vector(v).length);
  }

  function slice(p: Polygon, c1: Point, c2: Point): Polygon[] {
    const v0 = findLongestEdge(p);
    const v1 = p.next(v0);
    const v = v1.subtract(v0);

    const ratio = 0.4 + rng.float() * 0.2;
    const p1 = interpolate(v0, v1, ratio);

    const c = Math.abs(scalar(v.x, v.y, c1.x, c1.y)) < Math.abs(scalar(v.x, v.y, c2.x, c2.y))
      ? c1 : c2;

    const halves = p.cut(p1, p1.add(c));
    const buildings: Polygon[] = [];

    // Cut returned uncut original — stop recursing and emit as a validated leaf.
    if (halves.length === 1) {
      if (!isDegenerate(p) && rng.bool(fill)) buildings.push(p);
      return buildings;
    }

    for (const half of halves) {
      if (half.square < minBlockSq * Math.pow(2, rng.normal() * 2 - 1)) {
        if (!isDegenerate(half) && rng.bool(fill)) buildings.push(half);
      } else {
        buildings.push(...slice(half, c1, c2));
      }
    }
    return buildings;
  }

  if (poly.square < minBlockSq) {
    return [poly];
  }

  const c1 = poly.vector(findLongestEdge(poly));
  const c2 = c1.rotate90();

  // Retry until we get blocks
  for (let attempt = 0; attempt < 100; attempt++) {
    const blocks = slice(poly, c1, c2);
    if (blocks.length > 0) return blocks;
  }
  return [poly];
}
