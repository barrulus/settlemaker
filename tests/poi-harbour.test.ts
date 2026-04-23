import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { IdAllocator } from '../src/output/id-allocator.js';
import { selectPois } from '../src/poi/poi-selector.js';
import { WardType } from '../src/types/interfaces.js';
import { Harbour } from '../src/wards/harbour.js';
import type { Polygon } from '../src/geom/polygon.js';

function makePort(large: boolean, overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'Port',
    population: large ? 20000 : 2000,
    port: true, citadel: false,
    walls: true, plaza: true, temple: false, shanty: false, capital: false,
    oceanBearing: 90,
    harbourSize: large ? 'large' : 'small',
    ...overrides,
  };
}

function buildingMap(model: ReturnType<typeof generateFromBurg>['model']): Map<Polygon, string> {
  const alloc = new IdAllocator();
  const map = new Map<Polygon, string>();
  for (const patch of model.patches) {
    if (!patch.ward) continue;
    for (const b of patch.ward.geometry) map.set(b, alloc.alloc('b'));
  }
  return map;
}

describe('selectPois — harbour', () => {
  it('emits one pier POI per pier polygon, ward_type=harbour, buildingId=null', () => {
    const { model } = generateFromBurg(makePort(true), { seed: 3 });
    expect(model.harbour).not.toBeNull();
    const pois = selectPois(model, 20000, new IdAllocator(), buildingMap(model));
    const piers = pois.filter(p => p.kind === 'pier');
    const harbour = model.harbour!.ward as Harbour;
    expect(harbour.piers.length).toBeGreaterThan(0);
    expect(piers).toHaveLength(harbour.piers.length);
    for (const p of piers) {
      expect(p.wardType).toBe(WardType.Harbour);
      expect(p.buildingId).toBeNull();
    }
  });

  it('emits 2 warehouse POIs for a large harbour (>= 3 piers)', () => {
    const { model } = generateFromBurg(makePort(true), { seed: 3 });
    expect(model.harbour).not.toBeNull();
    const harbour = model.harbour!.ward as Harbour;
    expect(harbour.piers.length).toBeGreaterThanOrEqual(3);
    const pois = selectPois(model, 20000, new IdAllocator(), buildingMap(model));
    const warehouses = pois.filter(p => p.kind === 'warehouse');
    expect(warehouses).toHaveLength(2);
    for (const w of warehouses) {
      expect(w.wardType).toBe(WardType.Harbour);
      expect(w.buildingId).not.toBeNull();
    }
  });

  it('emits 1 warehouse POI for a small harbour (< 3 piers)', () => {
    const { model } = generateFromBurg(makePort(false), { seed: 3 });
    expect(model.harbour).not.toBeNull();
    const harbour = model.harbour!.ward as Harbour;
    expect(harbour.piers.length).toBeLessThan(3);
    const pois = selectPois(model, 2000, new IdAllocator(), buildingMap(model));
    const warehouses = pois.filter(p => p.kind === 'warehouse');
    expect(warehouses).toHaveLength(1);
    expect(warehouses[0].wardType).toBe(WardType.Harbour);
    expect(warehouses[0].buildingId).not.toBeNull();
  });
});
