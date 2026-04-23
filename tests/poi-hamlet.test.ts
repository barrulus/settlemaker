import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { IdAllocator } from '../src/output/id-allocator.js';
import { selectPois } from '../src/poi/poi-selector.js';
import type { Polygon } from '../src/geom/polygon.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'Hamlet', population: 100, port: false, citadel: false,
    walls: false, plaza: false, temple: false, shanty: false, capital: false,
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

describe('selectPois — hamlet regime (P < 300)', () => {
  it('emits no POIs below the tavern threshold (P < 30)', () => {
    const { model } = generateFromBurg(makeBurg({ population: 20 }), { seed: 1 });
    const pois = selectPois(model, 20, new IdAllocator(), buildingMap(model));
    expect(pois.filter(p => p.kind === 'tavern')).toHaveLength(0);
    expect(pois.filter(p => p.kind === 'well')).toHaveLength(0);
  });

  it('emits tavern and well at P=30', () => {
    const { model } = generateFromBurg(makeBurg({ population: 30 }), { seed: 1 });
    const pois = selectPois(model, 30, new IdAllocator(), buildingMap(model));
    const kinds = pois.map(p => p.kind).sort();
    expect(kinds).toContain('tavern');
    expect(kinds).toContain('well');
    expect(kinds).not.toContain('smithy');
    expect(kinds).not.toContain('chapel');
  });

  it('adds chapel at P=50, smithy at P=80', () => {
    const { model: m50 } = generateFromBurg(makeBurg({ population: 50 }), { seed: 1 });
    const kinds50 = selectPois(m50, 50, new IdAllocator(), buildingMap(m50)).map(p => p.kind);
    expect(kinds50).toContain('chapel');
    expect(kinds50).not.toContain('smithy');

    const { model: m80 } = generateFromBurg(makeBurg({ population: 80 }), { seed: 1 });
    const kinds80 = selectPois(m80, 80, new IdAllocator(), buildingMap(m80)).map(p => p.kind);
    expect(kinds80).toContain('smithy');
  });

  it('emits stable only when an inn was adopted', () => {
    const { model } = generateFromBurg(
      makeBurg({ population: 200 }),
      { seed: 1 },
    );
    const pois = selectPois(model, 200, new IdAllocator(), buildingMap(model));
    const hasInn = pois.some(p => p.kind === 'inn');
    const hasStable = pois.some(p => p.kind === 'stable');
    expect(hasStable).toBe(hasInn);
  });

  it('well has building_id=null and ward_type=null when no plaza exists', () => {
    const { model } = generateFromBurg(
      makeBurg({ population: 100, plaza: false }),
      { seed: 1 },
    );
    const pois = selectPois(model, 100, new IdAllocator(), buildingMap(model));
    const wells = pois.filter(p => p.kind === 'well');
    expect(wells).toHaveLength(1);
    expect(wells[0].buildingId).toBeNull();
    expect(wells[0].wardType).toBeNull();
  });

  it('is deterministic for identical inputs', () => {
    const run = () => {
      const { model } = generateFromBurg(makeBurg({ population: 150 }), { seed: 42 });
      return selectPois(model, 150, new IdAllocator(), buildingMap(model))
        .map(p => `${p.kind}:${p.buildingId}:${p.point.x.toFixed(2)},${p.point.y.toFixed(2)}`);
    };
    expect(run()).toEqual(run());
  });
});
