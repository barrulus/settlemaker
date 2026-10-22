import { closestPointOnPolyline } from './geometry.js';
import type { Point } from '../types/point.js';
import type { VillageModel } from './types.js';

export interface BuildingAccessPath {
  buildingId: string;
  points: Point[];
}

/** Follow the building's own frontage, rather than shortcutting across a
 * neighbour's plot to whichever road happens to be nearest. The first point
 * is under the roof; the final point is inside the travelled surface. */
export function buildingAccessPaths(model: Pick<VillageModel, 'buildings' | 'lots' | 'lanes' | 'green'>): BuildingAccessPath[] {
  const lots = new Map(model.lots.map(lot => [lot.id, lot]));
  const lanes = new Map(model.lanes.map(lane => [lane.id, lane]));
  return model.buildings.flatMap(building => {
    const lot = lots.get(building.lotId);
    if (!lot) return [];
    const lane = lanes.get(lot.laneId);
    const end = lot.laneId === 'green' ? model.green.centre
      : lane && lane.points.length > 1 ? closestPointOnPolyline(lot.front, lane.points).point : undefined;
    return end ? [{ buildingId: building.id, points: [building.position, lot.front, end] }] : [];
  });
}
