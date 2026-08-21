import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { intrudesOnLane, overlaps } from '../../src/village/dwellings.js';
import { pointInPolygon } from '../../src/geom/point-in-polygon.js';
import { Point } from '../../src/types/point.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const water = [[{ x: 60, y: -200 }, { x: 400, y: -200 }, { x: 400, y: 400 }, { x: 60, y: 400 }]];

const inputs: AzgaarBurgInput[] = [
  { name: 'A', population: 80, port: false, citadel: false, walls: false, plaza: false,
    temple: false, shanty: false, capital: false, roadBearings: [225] },
  { name: 'B', population: 450, port: false, citadel: false, walls: false, plaza: false,
    temple: false, shanty: false, capital: false,
    roadBearings: [{ bearing_deg: 90, kind: 'road', through: true }] },
  { name: 'C', population: 900, port: true, citadel: false, walls: false, plaza: false,
    temple: true, shanty: false, capital: false,
    roadBearings: [{ bearing_deg: 0, kind: 'road' }, { bearing_deg: 140, kind: 'foot' }],
    coastlineGeometry: water },
  // Finding 1 fixtures: colliding rounded bearings. Without the fix these
  // both produced duplicate lane ids downstream (arm-090 x2, arm-180 x2)
  // and therefore duplicate lot ids.
  { name: 'D', population: 300, port: false, citadel: false, walls: false, plaza: false,
    temple: false, shanty: false, capital: false,
    roadBearings: [
      { bearing_deg: 90.0, kind: 'road' },
      { bearing_deg: 90.2, kind: 'foot' },
    ] },
  { name: 'E', population: 300, port: false, citadel: false, walls: false, plaza: false,
    temple: false, shanty: false, capital: false,
    roadBearings: [
      { bearing_deg: 0, kind: 'road', through: true },
      { bearing_deg: 180, kind: 'road' },
    ] },
];

describe('village invariants (design §5.7)', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  it('never puts a lot in water', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        for (const lot of m.lots) {
          for (const ring of m.site.water) {
            expect(pointInPolygon(lot.front, ring)).toBe(false);
          }
        }
      }
    }
  });

  it('never overlaps two buildings', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const bs = generateVillage(input, seed).buildings;
        for (let i = 0; i < bs.length; i++) {
          for (let j = i + 1; j < bs.length; j++) {
            expect(overlaps(bs[i], bs[j])).toBe(false);
          }
        }
      }
    }
  });

  it('gives every lot a unique stable id', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        expect(new Set(m.lots.map((l) => l.id)).size).toBe(m.lots.length);
      }
    }
  });

  it('anchors every building to a lot that exists', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        const ids = new Set(m.lots.map((l) => l.id));
        for (const b of m.buildings) expect(ids.has(b.lotId)).toBe(true);
      }
    }
  });

  it('never seats a building on a road (gate 2: houses ON the roads)', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        for (const b of m.buildings) {
          expect(intrudesOnLane(b, m.lanes)).toBe(false);
        }
      }
    }
  });

  it('always produces at least one lane and one building', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        expect(m.lanes.length).toBeGreaterThan(0);
        expect(m.buildings.length).toBeGreaterThan(0);
      }
    }
  });

  it('never throws on a degenerate input', () => {
    const bare: AzgaarBurgInput = {
      name: 'Bare', population: 12, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
    };
    expect(() => generateVillage(bare, 1)).not.toThrow();
    const m = generateVillage(bare, 1);
    expect(m.green.shape).toBe('sm-green-round');
    void Point;
  });
});
