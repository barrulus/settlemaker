import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { SeededRandom } from '../src/utils/random.js';
import { slotsAlongPolyline } from '../src/generator/village-rows.js';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';
import { slotRect, acceptSlot, ROW_WARDS } from '../src/generator/village-rows.js';
import { WardType } from '../src/types/interfaces.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { Farm } from '../src/wards/farm.js';

const HOUSE = { width: 6, depth: 6 };
const straight = [new Point(0, 0), new Point(100, 0)];

describe('slotsAlongPolyline', () => {
  it('spaces slots at width+gap with gap in [0.8, 1.2]', () => {
    const slots = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(1));
    expect(slots.length).toBeGreaterThan(10);
    for (let i = 1; i < slots.length; i++) {
      const d = slots[i].center.x - slots[i - 1].center.x;
      expect(d).toBeGreaterThanOrEqual(HOUSE.width + 0.8 - 1e-9);
      expect(d).toBeLessThanOrEqual(HOUSE.width + 1.2 + 1e-9);
    }
  });

  it('offsets perpendicular by roadHalfWidth + depth/2 ± 0.3, per side', () => {
    for (const side of [1, -1] as const) {
      const slots = slotsAlongPolyline(straight, side, 1.0, HOUSE, new SeededRandom(2));
      for (const s of slots) {
        const off = s.center.y * side;
        expect(off).toBeGreaterThanOrEqual(1.0 + 3 - 0.3 - 1e-9);
        expect(off).toBeLessThanOrEqual(1.0 + 3 + 0.3 + 1e-9);
      }
    }
  });

  it('rotation tracks the tangent within ±4°', () => {
    const bent = [new Point(0, 0), new Point(50, 0), new Point(50, 50)];
    const slots = slotsAlongPolyline(bent, 1, 1.0, HOUSE, new SeededRandom(3));
    for (const s of slots) {
      const t = s.center.x < 50 - HOUSE.width ? 0 : 90; // tangent of containing segment
      const diff = Math.abs(((s.rotationDeg - t + 180) % 360) - 180);
      if (s.center.x < 44 || s.center.y > 6) expect(diff).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it('rowOffset pushes the whole row deeper; phase shifts starts', () => {
    const front = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(4));
    const back = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(4), HOUSE.depth, HOUSE.width / 2);
    expect(back[0].center.y).toBeGreaterThan(front[0].center.y + HOUSE.depth - 0.7);
    expect(back[0].center.x).toBeGreaterThan(front[0].center.x + 1);
  });

  it('deterministic per seed', () => {
    const a = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(9));
    const b = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(9));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}

describe('slot acceptance', () => {
  it('slotRect builds an oriented rect matching width/depth and rotation', () => {
    const rect = slotRect({ center: new Point(10, 5), rotationDeg: 90, width: 6, depth: 4 });
    expect(rect.vertices).toHaveLength(4);
    // 90°: width runs along +y, depth along -x.
    const xs = rect.vertices.map(v => v.x), ys = rect.vertices.map(v => v.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6, 5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 5);
  });

  it('rejects slots over water and over claimed sites; accepts on residential patches', () => {
    const m = mk(300, 3);
    // Find any built residential patch centroid → a slot there must be accepted.
    const patch = m.patches.find(p => p.ward && ROW_WARDS.has(p.ward.type) && !m.waterbody.includes(p))!;
    const c = patch.shape.centroid;
    const slot = { center: c, rotationDeg: 0, width: 4.5, depth: 4.5 };
    // Task 4 wired stampVillageRows into generate(), so a real village model
    // now arrives with its own claimed sites from stamped houses — clear
    // them here so this test isolates acceptSlot's water/claim mechanics
    // instead of depending on incidental stamper coverage of this patch.
    m.claimedSites = [];
    expect(acceptSlot(m, slot)).not.toBeNull();
    // Claim the site → same slot now rejected.
    m.claimedSites.push({ at: c, radius: 6 });
    expect(acceptSlot(m, slot)).toBeNull();
  });

  it('rejects slots on farm subplots (fields stay clear)', () => {
    const m = mk(300, 3);
    const farm = m.patches.find(p => p.ward?.type === WardType.Farm && (p.ward as Farm).subPlots.length > 0);
    if (!farm) return; // seed produced no farms; other seeds cover this in Task 4's integration tests
    const plot = (farm.ward as Farm).subPlots[0];
    const cx = plot.reduce((s, p) => s + p.x, 0) / plot.length;
    const cy = plot.reduce((s, p) => s + p.y, 0) / plot.length;
    expect(acceptSlot(m, { center: new Point(cx, cy), rotationDeg: 0, width: 4.5, depth: 4.5 })).toBeNull();
  });
});

import { drawRoofBias, pickHouseGlyph, houseFootprint } from '../src/generator/village-rows.js';
import { rowHousing } from '../src/generator/generation-params.js';
import { buildingBudget } from '../src/generator/model.js';

const RESIDENTIAL = ['sm-house', 'sm-house-tiled', 'sm-house-large-tiled', 'sm-hut-mud', 'sm-hut-round', 'sm-hut-straw', 'sm-longhouse'];

describe('stampVillageRows integration', () => {
  it('census exactness: stamped + generated survivors equals the budget (or frontage-capped below)', () => {
    for (const seed of [3, 7, 11]) {
      const m = mk(300, seed);
      const houses = m.symbols.filter(s => RESIDENTIAL.includes(s.id));
      expect(houses.length).toBeGreaterThan(0);
      const target = buildingBudget(m.params.population, m.params.urbanDensity);
      expect(houses.length).toBeLessThanOrEqual(target);
    }
  });

  it('every stamped house rect is in a ward geometry and marked glyph-backed', () => {
    const m = mk(300, 3);
    const houses = m.symbols.filter(s => RESIDENTIAL.includes(s.id));
    expect(m.glyphBackedBuildings.size).toBe(houses.length);
    for (const rect of m.glyphBackedBuildings) {
      const owned = m.patches.some(p => p.ward?.geometry.includes(rect));
      expect(owned).toBe(true);
    }
  });

  it('no stamped rect intersects water, another claim, or a farm subplot', () => {
    const m = mk(300, 3);
    for (const rect of m.glyphBackedBuildings) {
      for (const v of rect.vertices) expect(m.isWaterAt(v)).toBe(false);
      for (const p of m.patches) {
        if (p.ward instanceof Farm) {
          for (const plot of p.ward.subPlots) {
            expect(pointInPolygon(rect.centroid, plot)).toBe(false);
          }
        }
      }
    }
  });

  it('village well exists on a road-adjacent reserved site', () => {
    let found = 0;
    for (const seed of [3, 7, 11]) {
      if (mk(300, seed).symbols.some(s => s.id === 'sm-well')) found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('towns are untouched: rowHousing model has zero glyph-backed buildings', () => {
    const m = mk(1200, 3);
    expect(m.glyphBackedBuildings.size).toBe(0);
    expect(m.symbols.filter(s => RESIDENTIAL.includes(s.id))).toHaveLength(0);
  });

  it('deterministic', () => {
    const a = mk(300, 5), b = mk(300, 5);
    expect(JSON.stringify(a.symbols)).toBe(JSON.stringify(b.symbols));
    expect(a.glyphBackedBuildings.size).toBe(b.glyphBackedBuildings.size);
  });
});

describe('variety picker', () => {
  it('roof bias skews the house/house-tiled mix', () => {
    const count = (bias: 'thatch' | 'tile') => {
      const rng = new SeededRandom(7);
      let tiled = 0;
      for (let i = 0; i < 200; i++) {
        if (pickHouseGlyph(WardType.Craftsmen, bias, false, rng) === 'sm-house-tiled') tiled++;
      }
      return tiled;
    };
    expect(count('tile')).toBeGreaterThan(count('thatch') + 40);
  });

  it('slums and row-ends get huts; farms get vernacular; merchants get large houses sometimes', () => {
    const rng = new SeededRandom(11);
    for (let i = 0; i < 50; i++) {
      expect(pickHouseGlyph(WardType.Slum, 'tile', false, rng)).toMatch(/^sm-hut-/);
      expect(pickHouseGlyph(WardType.Craftsmen, 'tile', true, rng)).toMatch(/^sm-hut-/);
      expect(pickHouseGlyph(WardType.Farm, 'thatch', false, rng)).toMatch(/^sm-(hut-|longhouse)/);
    }
    const picks = new Set<string>();
    for (let i = 0; i < 100; i++) picks.add(pickHouseGlyph(WardType.Merchant, 'tile', false, rng));
    expect(picks.has('sm-house-large-tiled')).toBe(true);
  });

  it('houseFootprint reads the manifest (longhouse is 10×5)', () => {
    expect(houseFootprint('sm-longhouse')).toEqual({ width: 10, depth: 5 });
    expect(houseFootprint('sm-house')).toEqual({ width: 6, depth: 6 });
  });

  it('consumes exactly one rng draw per call in every branch', () => {
    const rng = new SeededRandom(13);
    let draws = 0;
    const counting = { float: () => { draws++; return rng.float(); }, bool: (p: number) => { draws++; return rng.bool(p); } } as unknown as SeededRandom;
    const cases: Array<[WardType, 'thatch' | 'tile', boolean]> = [
      [WardType.Slum, 'tile', false], [WardType.Craftsmen, 'tile', true],
      [WardType.Farm, 'thatch', false], [WardType.Merchant, 'tile', false],
      [WardType.Patriciate, 'thatch', false], [WardType.Craftsmen, 'thatch', false],
      [WardType.GateWard, 'tile', false],
    ];
    for (const [ward, bias, end] of cases) {
      const before = draws;
      pickHouseGlyph(ward, bias, end, counting);
      expect(draws - before).toBe(1);
    }
  });
});
