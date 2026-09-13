import type { Scene, ScenePoint } from '../scene/scene.js';
import type { DevelopmentProfile } from './development.js';

export interface SettlementBuilding {
  id: string;
  districtId: string;
  footprint: ScenePoint[];
  capacity: number;
  residents: number;
  insideWalls: boolean;
  urbanity: number;
}

export interface ResidentAccount {
  requested: number;
  capacity: number;
  assigned: number;
  unassigned: number;
}

export interface SettlementDistrict {
  id: string;
  boundary: ScenePoint[];
  urbanity: number;
  insideWalls: boolean;
}

/** Authoritative output geometry. Every coordinate and length is in local metres. */
export interface SettlementModel {
  version: 1;
  name: string;
  seed: number;
  development: DevelopmentProfile;
  coordinateSystem: 'local_metres_y_down';
  scene: Scene;
  buildings: SettlementBuilding[];
  districts: SettlementDistrict[];
  residents: ResidentAccount & {
    insideWalls: ResidentAccount;
    outsideWalls: ResidentAccount;
  };
  diagnostics: string[];
}

/** Deterministic allocation within each enclosure. Never borrow capacity across a wall target. */
export function allocateResidents(buildings: SettlementBuilding[], population: number, corePopulation: number | null): SettlementModel['residents'] {
  for (const b of buildings) b.residents = 0;
  const inside = buildings.filter(b => b.insideWalls);
  const outside = buildings.filter(b => !b.insideWalls);
  const capacityOf = (items: SettlementBuilding[]) => items.reduce((n, b) => n + b.capacity, 0);
  const insideTarget = corePopulation ?? Math.min(population, capacityOf(inside));
  const assign = (items: SettlementBuilding[], requested: number): ResidentAccount => {
    const capacity = capacityOf(items);
    const assigned = Math.min(requested, capacity);
    // Proportional occupancy keeps outer districts inhabited; sorting makes the
    // largest-remainder tie break stable even if a caller reordered features.
    const shares = items.map(b => {
      const exact = capacity ? assigned * b.capacity / capacity : 0;
      b.residents = Math.floor(exact);
      return { b, fraction: exact - b.residents };
    }).sort((a, b) => b.fraction - a.fraction || a.b.id.localeCompare(b.b.id));
    const remainder = assigned - items.reduce((n, b) => n + b.residents, 0);
    for (let i = 0; i < remainder; i++) shares[i].b.residents++;
    return { requested, capacity, assigned, unassigned: requested - assigned };
  };
  const insideWalls = assign(inside, insideTarget);
  const outsideWalls = assign(outside, population - insideTarget);
  return {
    requested: population, capacity: insideWalls.capacity + outsideWalls.capacity,
    assigned: insideWalls.assigned + outsideWalls.assigned,
    unassigned: insideWalls.unassigned + outsideWalls.unassigned,
    insideWalls, outsideWalls,
  };
}
