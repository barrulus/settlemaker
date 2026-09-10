/** Bank-to-bank bridge geometry shared by SVG and GeoJSON. */
import { Point } from '../../types/point.js';
import { NARROW_WATER_M } from '../constants.js';
import { roadCrossSection } from '../cross-section.js';
import { arcLengths, bearingOf, dist, sampleAt } from '../geometry.js';
import { offsetPolyline } from '../parcels/strip.js';
import type { Lane, WaterCrossing } from '../types.js';
import { wetRuns } from './water-routing.js';

export function findWaterCrossings(lanes: Lane[], water: Point[][]): WaterCrossing[] {
  return [...lanes].sort((a, b) => a.id.localeCompare(b.id)).flatMap(lane =>
    wetRuns(lane.points, water).map((run, k) => {
      const start = run.points[0], next = run.points[1], end = run.points.at(-1)!, previous = run.points.at(-2)!;
      const extend = (a: Point, b: Point) => {
        const length = dist(a, b);
        return new Point(a.x + (a.x - b.x) / length, a.y + (a.y - b.y) / length);
      };
      const centreline = [extend(start, next), ...run.points, extend(end, previous)];
      const halfWidth = roadCrossSection(lane).surfaceM / 2 + 0.35;
      const deck = [...offsetPolyline(centreline, halfWidth, 1), ...offsetPolyline(centreline, halfWidth, -1).reverse()];
      const acc = arcLengths(run.points), spanM = run.endM - run.startM;
      return {
        id: `bridge:${lane.id}:${k}`, laneId: lane.id,
        position: sampleAt(run.points, acc, spanM / 2).p,
        bearingDeg: bearingOf(start, end), spanM, narrow: spanM <= NARROW_WATER_M,
        centreline, deck,
      };
    }));
}
