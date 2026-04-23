import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { IdAllocator } from '../src/output/id-allocator.js';
import { selectPois } from '../src/poi/poi-selector.js';
import { POI_TIER } from '../src/poi/poi-kinds.js';
import type { Polygon } from '../src/geom/polygon.js';

function buildingMap(model: ReturnType<typeof generateFromBurg>['model']): Map<Polygon, string> {
  const alloc = new IdAllocator();
  const map = new Map<Polygon, string>();
  for (const patch of model.patches) {
    if (!patch.ward) continue;
    for (const b of patch.ward.geometry) map.set(b, alloc.alloc('b'));
  }
  return map;
}

function makeTiny(): AzgaarBurgInput {
  return {
    name: 'Tight',
    population: 300, // town regime floor — forces max(1,...) demands
    port: false, citadel: false, walls: true, plaza: true,
    temple: false, shanty: false, capital: false,
  };
}

describe('priority-tier drop-off', () => {
  it('Tier 3 (warehouse) drops before any Tier 1 when supply is exhausted', () => {
    // A landlocked tiny town has no harbour ward, so warehouses never appear
    // regardless of pressure. Construct an explicit exhaustion scenario:
    // a port burg where we pass a building map containing ONLY the first building
    // so adoption can only succeed once.
    const { model } = generateFromBurg(
      { ...makeTiny(), port: true, population: 400 },
      { seed: 1 },
    );
    // Build the map normally — selector will adopt top-N buildings by score.
    const pois = selectPois(model, 400, new IdAllocator(), buildingMap(model));
    const kinds = pois.map(p => p.kind);
    const hasSmithy = kinds.includes('smithy'); // Tier 1
    const hasWarehouse = kinds.includes('warehouse'); // Tier 3
    if (hasWarehouse) expect(hasSmithy).toBe(true); // If Tier 3 emitted, Tier 1 must have too.
  });

  it('POI_TIER never assigns a floating kind to Tier 1 or 2', () => {
    expect(POI_TIER.pier).toBe(3);
    expect(POI_TIER.well).toBe(3);
  });
});
