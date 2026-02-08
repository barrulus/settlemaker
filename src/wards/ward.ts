import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { SeededRandom } from '../utils/random.js';
import { WardType } from '../types/interfaces.js';
import { bisect } from '../geom/cutter.js';
import { interpolate, scalar, distance2line } from '../geom/geom-utils.js';
import { minBy } from '../utils/array-utils.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

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

  createGeometry(): void {
    this.geometry = [];
  }

  getCityBlock(): Polygon {
    const insetDist: number[] = [];
    const innerPatch = this.model.wall === null || this.patch.withinWalls;

    this.patch.shape.forEdge((v0, v1) => {
      if (this.model.wall !== null && this.model.wall.bordersBy(this.patch, v0, v1)) {
        insetDist.push(MAIN_STREET / 2);
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
        insetDist.push((onStreet ? MAIN_STREET : (innerPatch ? REGULAR_STREET : ALLEY)) / 2);
      }
    });

    return this.patch.shape.isConvex()
      ? this.patch.shape.shrink(insetDist)
      : this.patch.shape.buffer(insetDist);
  }

  filterOutskirts(): void {
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

      return this.rng.fuzzy(1) > minDist;
    });
  }

  getLabel(): string | null {
    return null;
  }

  static rateLocation(_model: Model, _patch: Patch): number {
    return 0;
  }
}

/** Recursive alley-based building subdivision */
export function createAlleys(
  p: Polygon,
  rng: SeededRandom,
  minSq: number,
  gridChaos: number,
  sizeChaos: number,
  emptyProb: number = 0.04,
  split: boolean = true,
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

  const halves = bisect(p, v!, ratio, b, split ? ALLEY : 0);

  const buildings: Polygon[] = [];
  for (const half of halves) {
    if (half.square < minSq * Math.pow(2, 4 * sizeChaos * (rng.float() - 0.5))) {
      if (half.length >= 4 && !rng.bool(emptyProb)) {
        buildings.push(half);
      }
    } else {
      buildings.push(
        ...createAlleys(
          half, rng, minSq, gridChaos, sizeChaos, emptyProb,
          half.square > minSq / (rng.float() * rng.float()),
        ),
      );
    }
  }

  return buildings;
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
    for (const half of halves) {
      if (half.square < minBlockSq * Math.pow(2, rng.normal() * 2 - 1)) {
        if (rng.bool(fill)) buildings.push(half);
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
