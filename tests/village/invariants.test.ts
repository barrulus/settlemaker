import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { intrudesOnLane, overlaps } from '../../src/village/dwellings.js';
import { lotObb, obbOverlap } from '../../src/village/parcels/overlap.js';
import { closestPointOnSegment, dist } from '../../src/village/geometry.js';
import {
  FRONT_ON_LANE_EPS_M, GREEN_JOIN_RATIO, LANE_SETBACK_M, RING_SETBACK_M,
} from '../../src/village/constants.js';
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

  // Fix round 1 (2026-08-21): MAX_FEEDBACK_ROUNDS went 3 -> 4 to restore
  // full-census housing after the seatEfficiency fix, so every test below
  // that regenerates the full input x seed grid now runs one more round
  // per village. 20s clears it with headroom even under parallel load.
  const GRID_TIMEOUT_MS = 20000;

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
  }, GRID_TIMEOUT_MS);

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
  }, GRID_TIMEOUT_MS);

  it('gives every lot a unique stable id', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        expect(new Set(m.lots.map((l) => l.id)).size).toBe(m.lots.length);
      }
    }
  }, GRID_TIMEOUT_MS);

  it('anchors every building to a lot that exists', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        const ids = new Set(m.lots.map((l) => l.id));
        for (const b of m.buildings) expect(ids.has(b.lotId)).toBe(true);
      }
    }
  }, GRID_TIMEOUT_MS);

  it('never seats a building on a road (gate 2: houses ON the roads)', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        for (const b of m.buildings) {
          expect(intrudesOnLane(b, m.lanes)).toBe(false);
        }
      }
    }
  }, GRID_TIMEOUT_MS);

  it('always produces at least one lane and one building', () => {
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        expect(m.lanes.length).toBeGreaterThan(0);
        expect(m.buildings.length).toBeGreaterThan(0);
      }
    }
  }, GRID_TIMEOUT_MS);

  // §5.7 property tests for the R20 debt (§5.4 rules 3-4): after
  // resolveConvergingLots, lot claims must be disjoint (up to float noise)
  // and every front must still sit where its lane or the green put it.
  it('never overlaps two lot claims (§5.4 rules 3-4)', () => {
    // Float-noise slack, not a design tolerance: two genuinely touching
    // claims (the owner's density rule) sit at ~0 m interpenetration: this
    // just keeps that from tripping on rounding.
    const OVERLAP_EPS_M = 0.25;
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        const obbs = m.lots.map((l) => lotObb(l));
        for (let i = 0; i < obbs.length; i++) {
          for (let j = i + 1; j < obbs.length; j++) {
            expect(obbOverlap(obbs[i], obbs[j], OVERLAP_EPS_M)).toBe(false);
          }
        }
      }
    }
  }, GRID_TIMEOUT_MS);

  it("every lot's front lies on its lane or the green (§5.4 rules 3-4)", () => {
    // Fix round 2: the model itself (village-model.ts's survivingLots
    // filter) now drops a lane lot whose front no longer lies on its
    // surviving (post-trim, post-relax) lane — a stale claim the fields
    // pass would otherwise clip against. So this checks EVERY lot in the
    // returned model, not just housed ones. FRONT_ON_LANE_EPS_M (same
    // constant the model filter uses) absorbs relaxLanes's up-to-
    // RELAX_MAX_DISPLACEMENT_M nudge and offsetPolyline's mitred-corner
    // swing at a sharp bend (miter capped at 4x the setback in strip.ts).
    for (const input of inputs) {
      for (const seed of seeds) {
        const m = generateVillage(input, seed);
        const laneById = new Map(m.lanes.map((l) => [l.id, l]));
        for (const lot of m.lots) {
          if (lot.laneId === 'green') {
            const radius = (m.green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
            expect(Math.abs(dist(lot.front, m.green.centre) - radius)).toBeLessThan(FRONT_ON_LANE_EPS_M);
            continue;
          }
          const lane = laneById.get(lot.laneId);
          expect(lane).toBeDefined();
          const setback = lane!.widthM / 2 + (LANE_SETBACK_M[lane!.type] ?? 2);
          let nearest = Infinity;
          for (let i = 1; i < lane!.points.length; i++) {
            const q = closestPointOnSegment(lot.front, lane!.points[i - 1], lane!.points[i]);
            nearest = Math.min(nearest, dist(lot.front, q));
          }
          expect(Math.abs(nearest - setback)).toBeLessThan(FRONT_ON_LANE_EPS_M);
        }
      }
    }
  }, GRID_TIMEOUT_MS);

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
