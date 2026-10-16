import type { Scene, ScenePoint } from '../scene/scene.js';
import type { DevelopmentProfile } from './development.js';
import type { WaterContextResult } from '../input/water-context.js';
import type { DegradedFlag } from '../generator/generation-params.js';
import type { NeighbourhoodCharacter } from '../generator/city-neighbourhoods.js';

export interface SettlementBuilding {
  id: string;
  districtId: string;
  footprint: ScenePoint[];
  capacity: number;
  residents: number;
  insideWalls: boolean;
  urbanity: number;
  settlementRole?: 'urban' | 'rural';
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
  settlementRole?: 'urban' | 'rural';
  character?: NeighbourhoodCharacter | 'green' | 'civic' | 'rural';
  /** Accepted building-footprint area and district ground in square metres.
   * Artwork courtyards/voids are accounted separately by the ground review. */
  occupiedAreaM2?: number;
  areaM2?: number;
}

/** Authoritative output geometry. Every coordinate and length is in local metres. */
export interface SettlementModel {
  version: 1;
  /** Geometry/appearance algorithm revision, separate from the model schema. */
  generatorRevision?: string;
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
    urban?: ResidentAccount;
    rural?: ResidentAccount;
  };
  diagnostics: string[];
  waterContextResult?: WaterContextResult;
  degradedFlags?: DegradedFlag[];
}

/** Deterministic allocation within each enclosure. Never borrow capacity across a wall target. */
export function allocateResidents(buildings: SettlementBuilding[], population: number, corePopulation: number | null, ruralPopulation = 0): SettlementModel['residents'] {
  for (const b of buildings) b.residents = 0;
  const inside = buildings.filter(b => b.insideWalls);
  const outside = buildings.filter(b => !b.insideWalls);
  const capacityOf = (items: SettlementBuilding[]) => items.reduce((n, b) => n + b.capacity, 0);
  const insideTarget = corePopulation ?? Math.min(population - ruralPopulation, capacityOf(inside));
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
  const combine = (a: ResidentAccount, b: ResidentAccount): ResidentAccount => ({
    requested: a.requested + b.requested, capacity: a.capacity + b.capacity,
    assigned: a.assigned + b.assigned, unassigned: a.unassigned + b.unassigned,
  });
  let outsideWalls: ResidentAccount, urban: ResidentAccount, rural: ResidentAccount;
  if (ruralPopulation > 0) {
    rural = assign(outside.filter(b => b.settlementRole === 'rural'), ruralPopulation);
    const outerUrban = assign(outside.filter(b => b.settlementRole !== 'rural'), population - insideTarget - ruralPopulation);
    outsideWalls = combine(outerUrban, rural);
    urban = combine(insideWalls, outerUrban);
  } else {
    outsideWalls = assign(outside, population - insideTarget);
    const ruralBuildings = outside.filter(b => b.settlementRole === 'rural');
    const assigned = ruralBuildings.reduce((n,b) => n + b.residents, 0);
    // With no explicit rural target preserve the legacy proportional farm
    // occupancy. This is existing countryside, not new regional demand.
    rural = { requested: assigned, capacity: capacityOf(ruralBuildings), assigned, unassigned: 0 };
    const all = combine(insideWalls, outsideWalls);
    urban = { requested: all.requested - assigned, capacity: all.capacity - rural.capacity,
      assigned: all.assigned - assigned, unassigned: all.unassigned };
  }
  return {
    requested: population, capacity: insideWalls.capacity + outsideWalls.capacity,
    assigned: insideWalls.assigned + outsideWalls.assigned,
    unassigned: insideWalls.unassigned + outsideWalls.unassigned,
    insideWalls, outsideWalls, urban, rural,
  };
}
