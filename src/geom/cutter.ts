import { Point } from '../types/point.js';
import { Polygon } from './polygon.js';
import { interpolate } from './geom-utils.js';
import { minBy } from '../utils/array-utils.js';

/**
 * Polygon cutting operations — port of Cutter.hx.
 * bisect, radial, semiRadial, ring
 */

/** Bisect a polygon along a line through a vertex at given ratio and angle */
export function bisect(
  poly: Polygon,
  vertex: Point,
  ratio: number = 0.5,
  angle: number = 0,
  gap: number = 0,
): Polygon[] {
  const next = poly.next(vertex);
  const p1 = interpolate(vertex, next, ratio);
  const d = next.subtract(vertex);

  const cosB = Math.cos(angle);
  const sinB = Math.sin(angle);
  const vx = d.x * cosB - d.y * sinB;
  const vy = d.y * cosB + d.x * sinB;
  const p2 = new Point(p1.x - vy, p1.y + vx);

  return poly.cut(p1, p2, gap);
}

/** Split polygon into radial sectors from center */
export function radial(poly: Polygon, center?: Point, gap: number = 0): Polygon[] {
  if (!center) center = poly.centroid;

  const sectors: Polygon[] = [];
  poly.forEdge((v0, v1) => {
    let sector = new Polygon([center!, v0, v1]);
    if (gap > 0) {
      sector = sector.shrink([gap / 2, 0, gap / 2]);
    }
    sectors.push(sector);
  });
  return sectors;
}

/** Semi-radial split: like radial but center is a vertex of the polygon */
export function semiRadial(poly: Polygon, center?: Point, gap: number = 0): Polygon[] {
  if (!center) {
    const centroid = poly.centroid;
    center = minBy(poly.vertices, (v: Point) => Point.distance(v, centroid));
  }

  const halfGap = gap / 2;
  const sectors: Polygon[] = [];

  poly.forEdge((v0, v1) => {
    if (v0 !== center && v1 !== center) {
      let sector = new Polygon([center!, v0, v1]);
      if (halfGap > 0) {
        const d = [
          poly.findEdge(center!, v0) === -1 ? halfGap : 0,
          0,
          poly.findEdge(v1, center!) === -1 ? halfGap : 0,
        ];
        sector = sector.shrink(d);
      }
      sectors.push(sector);
    }
  });

  return sectors;
}

/** Cut a ring of given thickness around the polygon edges */
export function ring(poly: Polygon, thickness: number): Polygon[] {
  const slices: { p1: Point; p2: Point; len: number }[] = [];

  poly.forEdge((v1, v2) => {
    const v = v2.subtract(v1);
    const n = v.rotate90().norm(thickness);
    slices.push({ p1: v1.add(n), p2: v2.add(n), len: v.length });
  });

  // Short sides first
  slices.sort((s1, s2) => s1.len - s2.len);

  const peel: Polygon[] = [];
  let p = poly;
  for (const slice of slices) {
    const halves = p.cut(slice.p1, slice.p2);
    p = halves[0];
    if (halves.length === 2) {
      peel.push(halves[1]);
    }
  }

  return peel;
}
