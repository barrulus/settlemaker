import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import { arcLengths, closestPointOnSegment, dist, sampleAt } from './geometry.js';
import { offsetPolyline } from './parcels/strip.js';

/** Coarse river surveys become a sampled channel before roads or lots exist.
 * Detailed coastlineGeometry remains authoritative and is never distorted. */
export function riverPolygons(input: AzgaarBurgInput, seed: number): Point[][] {
  return (input.rivers ?? []).flatMap((river, index) => {
    if (!(river.widthM > 0) || !Number.isFinite(river.widthM)) return [];
    const points = river.centreline.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map(p => new Point(p.x, p.y)).filter((p, i, all) => i === 0 || dist(p, all[i - 1]) > .001);
    if (points.length < 2) return [];
    const acc = arcLengths(points), length = acc.at(-1)!;
    let anchor = 0, nearest = Infinity;
    for (let i = 1; i < points.length; i++) {
      const q = closestPointOnSegment(new Point(0, 0), points[i - 1], points[i]);
      if (dist(q, new Point(0, 0)) < nearest) { nearest = dist(q, new Point(0, 0)); anchor = acc[i - 1] + dist(points[i - 1], q); }
    }
    const rng = new SeededRandom(seed * 3571 + index * 7919 + 1013);
    const wavelength = Math.max(300, 30 * Math.sqrt(Math.max(1, input.population)));
    const amplitude = Math.min(40, wavelength * .075, length * .05);
    const phase = rng.float() * Math.PI * 2;
    const wave = (s: number) => Math.sin(s * Math.PI * 2 / wavelength + phase)
      + .18 * Math.sin(s * Math.PI * 2 / (wavelength * .57) + phase * 1.7);
    const steps = Math.ceil(length / 6), centreline: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const s = length * i / steps, p = sampleAt(points, acc, s).p;
      const a = sampleAt(points, acc, Math.max(0, s - 3)).p;
      const b = sampleAt(points, acc, Math.min(length, s + 3)).p;
      const tangent = dist(a, b);
      if (tangent < 1e-8) { centreline.push(p); continue; }
      // Fixed survey endpoints and the nearest burg station anchor the river.
      const fade = Math.sin(Math.min(1, Math.min(s, length - s) / 80) * Math.PI / 2) ** 2;
      const offset = river.meander === false ? 0 : amplitude * (wave(s) - wave(anchor)) * fade;
      centreline.push(new Point(p.x - (b.y - a.y) / tangent * offset, p.y + (b.x - a.x) / tangent * offset));
    }
    return [[...offsetPolyline(centreline, river.widthM / 2, 1), ...offsetPolyline(centreline, river.widthM / 2, -1).reverse()]];
  });
}
