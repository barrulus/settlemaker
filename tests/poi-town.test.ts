import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { IdAllocator } from '../src/output/id-allocator.js';
import { selectPois } from '../src/poi/poi-selector.js';
import { WardType } from '../src/types/interfaces.js';
import type { Polygon } from '../src/geom/polygon.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'Town', population: 500, port: false, citadel: false,
    walls: true, plaza: true, temple: false, shanty: false, capital: false,
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

describe('selectPois — town regime (P >= 300)', () => {
  it('emits max(1, ...) floors at P=300', () => {
    const { model } = generateFromBurg(makeBurg({ population: 300 }), { seed: 7 });
    const pois = selectPois(model, 300, new IdAllocator(), buildingMap(model));
    const counts = new Map<string, number>();
    for (const p of pois) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    expect(counts.get('inn') ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.get('shop') ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.get('tavern') ?? 0).toBeGreaterThanOrEqual(2);
    expect(counts.get('smithy') ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.get('stable') ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('emits bathhouse only when P >= 5000', () => {
    const { model: small } = generateFromBurg(makeBurg({ population: 3000 }), { seed: 7 });
    const smallPois = selectPois(small, 3000, new IdAllocator(), buildingMap(small));
    expect(smallPois.some(p => p.kind === 'bathhouse')).toBe(false);

    const { model: big } = generateFromBurg(makeBurg({ population: 8000 }), { seed: 7 });
    const bigPois = selectPois(big, 8000, new IdAllocator(), buildingMap(big));
    expect(bigPois.some(p => p.kind === 'bathhouse')).toBe(true);
  });

  it('emits 1 cathedral per Cathedral ward', () => {
    const { model } = generateFromBurg(
      makeBurg({ population: 20000, temple: true, capital: true }),
      { seed: 7 },
    );
    const cathedralWards = model.patches.filter(p => p.ward?.type === WardType.Cathedral).length;
    const pois = selectPois(model, 20000, new IdAllocator(), buildingMap(model));
    const emitted = pois.filter(p => p.kind === 'cathedral').length;
    expect(emitted).toBe(cathedralWards);
  });

  it('skips guildhalls when no Administration ward exists', () => {
    const { model } = generateFromBurg(
      makeBurg({ population: 400, capital: false }),
      { seed: 7 },
    );
    const hasAdmin = model.patches.some(p => p.ward?.type === WardType.Administration);
    const pois = selectPois(model, 400, new IdAllocator(), buildingMap(model));
    const guildhalls = pois.filter(p => p.kind === 'guildhall').length;
    if (!hasAdmin) expect(guildhalls).toBe(0);
  });

  it('1:1 adoption — no two POIs share a building_id', () => {
    const { model } = generateFromBurg(makeBurg({ population: 5000 }), { seed: 7 });
    const pois = selectPois(model, 5000, new IdAllocator(), buildingMap(model));
    const ids = pois
      .map(p => p.buildingId)
      .filter((id): id is string => id !== null);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is deterministic for identical inputs', () => {
    const run = () => {
      const { model } = generateFromBurg(makeBurg({ population: 5000 }), { seed: 77 });
      return selectPois(model, 5000, new IdAllocator(), buildingMap(model))
        .map(p => `${p.kind}:${p.buildingId}`);
    };
    expect(run()).toEqual(run());
  });
});
