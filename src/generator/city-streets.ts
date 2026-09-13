import { Point } from '../types/point.js';
import type { Model } from './model.js';
import type { WardLane } from '../wards/ward.js';
import { Farm } from '../wards/farm.js';
import { WardType } from '../types/interfaces.js';
import { blocksAccess, drySegments, nearestOnSegment, wardFrontages } from './city-frontage.js';

/** Reserved streets between urban blocks. These are the same corridors used
 * to place buildings and connect service lanes, not new cuts through lots. */
export function cityLocalStreets(model: Model): WardLane[] {
  if (!model.usesCityLayout) return [];
  const key = (a: WardLane['a'], b: WardLane['b']) => {
    const ends = [a, b].map(p => `${p.x.toFixed(7)},${p.y.toFixed(7)}`).sort();
    return ends.join('/');
  };
  const seen = new Set<string>();
  for (const path of [...model.arteries, ...model.roads]) {
    for (let i = 1; i < path.length; i++) seen.add(key(path.vertices[i - 1], path.vertices[i]));
  }
  const streets: WardLane[] = [];
  for (const patch of model.patches) {
    const ward = patch.ward;
    if (!ward || ward instanceof Farm || model.waterbody.includes(patch)
      || ward.type === WardType.Empty || ward.type === WardType.Water) continue;
    for (const line of wardFrontages(ward)) {
      if (line.kind !== 'street') continue;
      const id = key(line.a, line.b);
      if (seen.has(id)) continue;
      seen.add(id);
      streets.push({ a: line.a, b: line.b, width: line.width });
    }
  }
  return streets;
}

/** Subdivision cuts stop at the edge of reserved corridors. Join those mouths
 * to their street centreline so SVG and exported navigation have the same graph. */
export function connectCityLanes(model: Model): void {
  if (!model.usesCityLayout) return;
  const water = model.getWaterRings();
  for (const patch of model.patches) {
    const ward = patch.ward;
    if (!ward?.lanes.length) continue;
    const lanes = [...ward.lanes], lines = wardFrontages(ward);
    for (const lane of lanes) for (const endpoint of [lane.a, lane.b]) {
      const candidates = lines.filter(line => line.a !== lane.a || line.b !== lane.b)
        .map(line => {
          const at = nearestOnSegment(endpoint, line.a, line.b);
          return { at, distance: Point.distance(endpoint, at), width: line.width };
        }).filter(c => c.distance <= c.width / 2 + 1e-6)
        .sort((a, b) => a.distance - b.distance);
      if (candidates.some(c => c.distance < 1e-6)) continue;
      const candidate = candidates.find(c => {
        const dry = drySegments(endpoint, c.at, water);
        return dry.length === 1 && dry[0][0] === endpoint && dry[0][1] === c.at
          && !ward.geometry.some(building => blocksAccess(endpoint, c.at, building));
      });
      if (candidate) ward.lanes.push({ a: endpoint, b: candidate.at, width: lane.width });
    }
  }
}
