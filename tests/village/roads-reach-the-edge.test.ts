/**
 * Spec 2026-09-07 §9: the invariants that say the roads actually got there,
 * measured on the shipped model rather than on any one stage of it.
 */
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { isApron } from '../../src/village/types.js';
import { computeFrame } from '../../src/village/frame.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const POPS = [40, 120, 300, 500, 1000];
const SEEDS = [1, 2, 7, 55337];

const burg = (population: number): AzgaarBurgInput => ({
  name: 'Aldford', population, port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 45, kind: 'main' }, { bearing_deg: 170, kind: 'local' },
    { bearing_deg: 280, kind: 'trail' },
  ],
} as unknown as AzgaarBurgInput);

const each = (fn: (m: ReturnType<typeof generateVillage>, label: string) => void): void => {
  for (const pop of POPS) {
    for (const seed of SEEDS) fn(generateVillage(burg(pop), seed), `pop ${pop} seed ${seed}`);
  }
};

describe('roads reach the edge of the tile', () => {
  it('every contract entry ends on the frame boundary', () => {
    each((m, label) => {
      const { minX, minY, maxX, maxY } = m.frame;
      const aprons = m.lanes.filter((l) => isApron(l.id));
      expect(aprons.length, `${label}: no aprons at all`).toBeGreaterThan(0);
      for (const a of aprons) {
        const tip = a.points[a.points.length - 1];
        const toEdge = Math.min(tip.x - minX, maxX - tip.x, tip.y - minY, maxY - tip.y);
        const excused = m.diagnostics.some((d) => d.startsWith('coast:') || d.startsWith('apron:'));
        expect(toEdge <= 1 || excused, `${label}: ${a.id} stops ${toEdge.toFixed(0)} m short`).toBe(true);
      }
    });
  });

  it('the overshoot was always long enough to be clipped', () => {
    // If an apron was never clipped it ran out of drawn road before it
    // reached the frame, and APRON_REACH_FACTOR is too small.
    each((m, label) => {
      const { minX, minY, maxX, maxY } = m.frame;
      for (const a of m.lanes.filter((l) => isApron(l.id))) {
        const tip = a.points[a.points.length - 1];
        const onEdge = Math.min(tip.x - minX, maxX - tip.x, tip.y - minY, maxY - tip.y) <= 1;
        const excused = m.diagnostics.some((d) => d.startsWith('coast:'));
        expect(onEdge || excused, `${label}: ${a.id} was never clipped`).toBe(true);
      }
    });
  });

  it('nothing is built on an apron', () => {
    each((m, label) => {
      const apronIds = new Set(m.lanes.filter((l) => isApron(l.id)).map((l) => l.id));
      expect(m.lots.filter((l) => apronIds.has(l.laneId)), `${label}: lots on an apron`)
        .toHaveLength(0);
      const lotById = new Map(m.lots.map((l) => [l.id, l]));
      for (const b of m.buildings) {
        const lot = lotById.get(b.lotId);
        expect(lot && apronIds.has(lot.laneId), `${label}: ${b.id} seated on an apron`)
          .toBeFalsy();
      }
    });
  });

  it('the frame does not move when the aprons are taken away', () => {
    each((m, label) => {
      const without = computeFrame({
        lanes: m.lanes.filter((l) => !isApron(l.id)),
        buildings: m.buildings.map((b) => b.position),
        greenCentre: m.green.centre,
        dressing: [
          ...m.fields.flatMap((f) => f.polygon),
          ...m.fieldEdges.map((e) => e.position),
          ...m.vegetation.map((v) => v.position),
          ...m.pois.map((p) => p.position),
        ],
      });
      expect(without, `${label}: aprons are driving the bounds`).toEqual(m.frame);
    });
  });
});
