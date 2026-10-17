import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import { arcLengths, closestPointOnSegment, dist, sampleAt } from './geometry.js';
import { offsetPolyline } from './parcels/strip.js';

/** Coarse river surveys become a sampled channel before roads or lots exist.
 * Detailed coastlineGeometry remains authoritative and is never distorted. */
export function riverPolygons(input: AzgaarBurgInput, seed: number, selectedIndices?: ReadonlySet<number>): Point[][] {
  return (input.rivers ?? []).flatMap((river, index) => {
    if (selectedIndices && !selectedIndices.has(index)) return [];
    if (!(river.widthM > 0) || !Number.isFinite(river.widthM)) return [];
    const surveyed = river.centreline.map((p, i) => ({ point: new Point(p.x, p.y), width: river.widthsM?.[i] ?? river.widthM }))
      .filter(({ point, width }) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(width) && width > 0)
      .filter(({ point }, i, all) => i === 0 || dist(point, all[i - 1].point) > .001);
    const points = surveyed.map(p => p.point);
    if (points.length < 2) return [];
    if (river.meander === false || river.widthSource === 'fmg-local-width-model' || river.courseSource === 'fmg-catmull-rom-0.1') {
      // A surveyed course is already shaped. Resampling at fixed stations
      // would cut across bends and move authored banks by several metres.
      const halfWidths = surveyed.map(p => p.width / 2);
      return [[...offsetPolyline(points, halfWidths, 1),
        ...offsetPolyline(points, halfWidths, -1).reverse()]];
    }
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
    const steps = Math.ceil(length / 6), centreline: Point[] = [], halfWidths: number[] = [];
    let section = 1;
    for (let i = 0; i <= steps; i++) {
      const s = length * i / steps, p = sampleAt(points, acc, s).p;
      while (section < acc.length - 1 && s > acc[section]) section++;
      const fraction = (s - acc[section - 1]) / (acc[section] - acc[section - 1]);
      halfWidths.push((surveyed[section - 1].width * (1 - fraction) + surveyed[section].width * fraction) / 2);
      const a = sampleAt(points, acc, Math.max(0, s - 3)).p;
      const b = sampleAt(points, acc, Math.min(length, s + 3)).p;
      const tangent = dist(a, b);
      if (tangent < 1e-8) { centreline.push(p); continue; }
      // Fixed survey endpoints and the nearest burg station anchor the river.
      const fade = Math.sin(Math.min(1, Math.min(s, length - s) / 80) * Math.PI / 2) ** 2;
      const offset = amplitude * (wave(s) - wave(anchor)) * fade;
      centreline.push(new Point(p.x - (b.y - a.y) / tangent * offset, p.y + (b.x - a.x) / tangent * offset));
    }
    return [[...offsetPolyline(centreline, halfWidths, 1), ...offsetPolyline(centreline, halfWidths, -1).reverse()]];
  });
}
