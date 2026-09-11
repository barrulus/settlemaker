/*!
polygon-clipping
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


splaytree

The MIT License (MIT)

Copyright (c) 2019 Alexander Milevski <info@w8r.name>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


robust-predicates
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org>
*/
import polygonClipping from 'polygon-clipping';
import { Point } from '../types/point.js';
import { coverageExceeded, WaterContextError } from '../input/water-context.js';

interface WaterDomain { radius: number; paths: Point[][]; rings: Point[][]; polygons: Point[][][]; segments: Array<[Point, Point]>; }
const domains = new WeakMap<Point[][], WaterDomain>();
const ringDomains = new WeakMap<Point[], number>();
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;

/** Cache the dissolved union once per immutable site. Rings include their closing
 * point; exposed paths can be open where the survey square cuts the water. */
export function prepareWaterBoundary(water: Point[][], radius: number): void {
  let union: polygonClipping.MultiPolygon;
  try {
    const polys = water.map(r => [r.map(p => [p.x, p.y] as [number, number])]);
    union = polys.length ? polygonClipping.union(polys[0], ...polys.slice(1)) : [];
  } catch {
    throw new WaterContextError('water-context-invalid', 'Water polygon union could not be constructed.');
  }
  const polygons = union.map(poly => poly.map(r => r.map(([x, y]) => new Point(x, y))));
  const rings = polygons.flat();
  const paths: Point[][] = [];
  const crop = (a: Point, b: Point) => [a.x, a.y].some((v, axis) =>
    Math.abs(Math.abs(v) - radius) < 1e-6 && Math.abs(v - (axis === 0 ? b.x : b.y)) < 1e-6);
  for (const ring of rings) {
    const count = ring.length - 1;
    const cut = ring.slice(0, -1).findIndex((a, i) => crop(a, ring[i + 1]));
    if (cut < 0) { paths.push(ring); continue; }
    let path: Point[] = [];
    for (let k = 1; k <= count; k++) {
      const i = (cut + k) % count, a = ring[i], b = ring[i + 1];
      if (crop(a, b)) { if (path.length > 1) paths.push(path); path = []; }
      else { if (!path.length) path.push(a); path.push(b); }
    }
    if (path.length > 1) paths.push(path);
  }
  for (const ring of water) ringDomains.set(ring, radius);
  domains.set(water, { radius, paths, rings, polygons, segments: paths.flatMap(r => r.slice(1).map((b, i): [Point, Point] => [r[i], b])) });
}
export function waterBoundaryPaths(water: Point[][]): Point[][] {
  return domains.get(water)?.paths ?? water.filter(r => r.length > 1).map(r => same(r[0], r.at(-1)!) ? r : [...r, r[0]]);
}
export function waterBoundarySegments(water: Point[][]): Array<[Point, Point]> {
  return domains.get(water)?.segments ?? waterBoundaryPaths(water).flatMap(r => r.slice(1).map((b, i): [Point, Point] => [r[i], b]));
}
export function waterFillRings(water: Point[][]): Point[][] | undefined { return domains.get(water)?.rings; }
export function assertWaterQuery(water: Point[][], point: Point, margin = 0): void {
  const domain = domains.get(water);
  if (domain && Math.hypot(point.x, point.y) + margin > domain.radius + 1e-7) {
    coverageExceeded(Math.hypot(point.x, point.y) + margin);
  }
}

export function assertWaterRingQuery(ring: Point[], point: Point, margin: number): void {
  const radius = ringDomains.get(ring);
  if (radius !== undefined && Math.hypot(point.x, point.y) + margin > radius) {
    coverageExceeded(Math.hypot(point.x, point.y) + margin);
  }
}

export function waterFillPolygons(water: Point[][]): Point[][][] | undefined { return domains.get(water)?.polygons; }
