import { describe, it, expect } from 'vitest';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';
import { selectPois } from '../src/poi/poi-selector.js';
import { IdAllocator } from '../src/output/id-allocator.js';
import type { Polygon } from '../src/geom/polygon.js';
import { WardType } from '../src/types/interfaces.js';

// Canonical test-model helper (pattern from tests/degraded-generation.test.ts).
function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}

// Mirrors the buildingMap() helper used by tests/poi-town.test.ts and
// tests/poi-hamlet.test.ts: allocator + buildingIdMap constructed the same
// way geojson-builder.ts does before calling selectPois.
function buildingMap(model: Model): Map<Polygon, string> {
  const alloc = new IdAllocator();
  const map = new Map<Polygon, string>();
  for (const patch of model.patches) {
    if (!patch.ward) continue;
    for (const b of patch.ward.geometry) map.set(b, alloc.alloc('b'));
  }
  return map;
}

function poisFor(m: Model) {
  const allocator = new IdAllocator();
  return selectPois(m, m.params.population, allocator, buildingMap(m));
}

describe('POI / placed-symbol coherence', () => {
  it('every placed well/mill/cross has a POI at its exact point, and no orphan POIs of those kinds', () => {
    for (const seed of [3, 7, 12]) {
      const m = mk(4000, seed, { plaza: true });
      const pois = poisFor(m);
      const byKind = (k: string) => pois.filter(p => p.kind === k);
      const placed = (id: string) => m.symbols.filter(s => s.id === id);
      if (placed('sm-well').length > 0) {
        expect(byKind('well').length).toBe(placed('sm-well').length);
      }
      for (const s of placed('sm-well')) {
        expect(byKind('well').some(p => p.point.x === s.at.x && p.point.y === s.at.y)).toBe(true);
      }
      expect(byKind('market').length).toBe(placed('sm-market-cross').length);
      for (const s of placed('sm-market-cross')) {
        expect(byKind('market')[0].point.x).toBe(s.at.x);
      }
      expect(byKind('mill').length).toBe(placed('sm-mill-wind').length);
    }
  });

  it('placed-well POIs carry the consuming ward\'s type, not null', () => {
    let sawPlacedWell = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const m = mk(4000, seed, { plaza: true });
      const placedWells = m.symbols.filter(s => s.id === 'sm-well');
      if (placedWells.length === 0) continue;
      sawPlacedWell = true;
      const pois = poisFor(m);
      const wellPois = pois.filter(p => p.kind === 'well');
      expect(wellPois.length).toBe(placedWells.length);
      for (const p of wellPois) {
        expect(p.wardType).not.toBeNull();
        expect(Object.values(WardType)).toContain(p.wardType);
      }
    }
    expect(sawPlacedWell).toBe(true);
  });

  it('hamlet with no placed well still gets its plaza well fallback', () => {
    // Village rows (Task 4, stampVillageRows) reserves a well unconditionally
    // whenever model.wellBudget > 0, which Model.createWards always sets to
    // >= 1 (Math.max(1, ...)) — so no seed can produce a real wellless
    // hamlet anymore. Strip the stamped well symbol to exercise
    // emitHamlet's plaza-fallback path directly; the fallback logic itself
    // (poi-selector.ts) is unchanged and still worth covering.
    const m = mk(100, 1);
    m.symbols = m.symbols.filter(s => s.id !== 'sm-well');
    const pois = poisFor(m);
    expect(pois.filter(p => p.kind === 'well').length).toBe(1);
  });
});
