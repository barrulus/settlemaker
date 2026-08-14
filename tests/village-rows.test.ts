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
