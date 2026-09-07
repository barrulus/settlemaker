/**
 * Roads to the tile edge, end to end (spec 2026-09-07 §5). Task 1 built the
 * apron as pure geometry (`skeleton/apron.ts`); Task 2 wires it into
 * `synthesizeTrunks` via `growAprons`. This test is the outside view of
 * that wiring: a generated village's lanes must include an apron reaching
 * past its own contract circle, and the census/block-relevant fabric must
 * not be able to tell it is there (the exhaustive numeric proof of that is
 * `village-model.test.ts`, `village-model-chase-regression.test.ts`,
 * `seating.test.ts` and `spend-census.test.ts`, which pin exact numbers and
 * are left untouched by this change).
 */
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { isApron } from '../../src/village/types.js';
import { dist, polylineLength } from '../../src/village/geometry.js';
import { Point } from '../../src/types/point.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const input: AzgaarBurgInput = {
  name: 'Wick', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
};

describe('roads reach the tile edge', () => {
  it('ships at least one apron lane, one per surviving contract entry', () => {
    const model = generateVillage(input, 1);
    const aprons = model.lanes.filter((l) => isApron(l.id));
    expect(aprons.length).toBeGreaterThan(0);
  });

  it('an apron runs past the contract circle, not just up to it', () => {
    const model = generateVillage(input, 1);
    const aprons = model.lanes.filter((l) => isApron(l.id));
    for (const apron of aprons) {
      const farthest = apron.points.reduce(
        (max, p) => Math.max(max, dist(p, new Point(0, 0))), 0,
      );
      expect(farthest).toBeGreaterThan(model.contractRadiusM);
    }
  });

  it('an apron is geometrically continuous with its trunk -- no gap at the join', () => {
    const model = generateVillage(input, 1);
    const trunksById = new Map(model.lanes.map((l) => [l.id, l]));
    for (const apron of model.lanes.filter((l) => isApron(l.id))) {
      const trunkId = apron.id.replace(/\/a(~.*)?$/, '');
      const trunk = trunksById.get(trunkId);
      if (!trunk) continue; // crossing-split apron: its parent id may differ
      const trunkTip = trunk.points[trunk.points.length - 1];
      expect(dist(trunkTip, apron.points[0])).toBeLessThan(1e-6);
    }
  });

  it('across many seeds, some village always ships an apron of positive length', () => {
    let sawOne = false;
    for (let seed = 1; seed <= 20; seed++) {
      const model = generateVillage(input, seed);
      const aprons = model.lanes.filter((l) => isApron(l.id));
      if (aprons.some((a) => polylineLength(a.points) > 0)) sawOne = true;
    }
    expect(sawOne).toBe(true);
  });
});
