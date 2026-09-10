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

const burg = (population: number, through: boolean): AzgaarBurgInput => ({
  name: 'Aldford', population, port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 45, kind: 'main', through },
    ...(through ? [{ bearing_deg: 217, kind: 'main' as const, through }] : []),
    { bearing_deg: 170, kind: 'local' },
    { bearing_deg: 280, kind: 'trail' },
  ],
} as unknown as AzgaarBurgInput);

/** Exercise one terminating approach and a continuing connection with two
 * independently measured sides. Both must reach the rendered frame. */
const each = (fn: (m: ReturnType<typeof generateVillage>, label: string) => void): void => {
  for (const through of [false, true]) {
    for (const pop of POPS) {
      for (const seed of SEEDS) {
        fn(generateVillage(burg(pop, through), seed),
          `pop ${pop} seed ${seed}${through ? ' through' : ''}`);
      }
    }
  }
};

/** One apron sample step, the same slack `growAprons` uses to decide a lane
 * end is sitting on an entry. */
const ON_ENTRY_M = 8;

/** Every point on the contract circle a road is contracted to arrive at:
 * one per supplied approach. Mirrors
 * `contractEntries`, which is the thing under test's own input. */
const contractEntryPoints = (
  m: ReturnType<typeof generateVillage>,
): { label: string; x: number; y: number }[] => {
  const out: { label: string; x: number; y: number }[] = [];
  const at = (bearingDeg: number, label: string): void => {
    const rad = (bearingDeg * Math.PI) / 180;
    out.push({
      label, x: Math.sin(rad) * m.contractRadiusM, y: -Math.cos(rad) * m.contractRadiusM,
    });
  };
  for (const r of m.site.routes) {
    at(r.bearingDeg, `entry ${r.bearingDeg.toFixed(0)}`);
  }
  return out;
};

const distance = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/** Shortest distance from (`x`, `y`) to a polyline. */
const toPolyline = (x: number, y: number, points: { x: number; y: number }[]): number => {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    best = Math.min(best, distance(x, y, a.x + dx * t, a.y + dy * t));
  }
  return best;
};

const onFrame = (m: ReturnType<typeof generateVillage>, p: { x: number; y: number }): boolean => {
  const { minX, minY, maxX, maxY } = m.frame;
  return Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y) <= 1;
};

/**
 * Is THIS apron excused, by a `coast:` diagnostic naming THIS lane?
 *
 * Fix round 3: this used to ask whether the village had any `coast:` line
 * at all, so one road that gave up at a bay silenced the assertion for
 * every other road in the village -- the blanket excuse the escape hatch
 * was deliberately kept narrow to avoid. The diagnostic names its lane, so
 * match on that.
 *
 * A crossing-split apron ships as `<laneId>~x<other>` while the diagnostic
 * was written before the split, hence the prefix form. `apron:` is NOT an
 * excuse: it says an apron was DROPPED for starting outside the tile, which
 * says nothing about the ones that remain.
 */
const excusedByCoast = (laneId: string, diagnostics: string[]): boolean =>
  diagnostics.some((d) => {
    if (!d.startsWith('coast: ')) return false;
    const named = d.slice('coast: '.length).split(' ')[0];
    return laneId === named || laneId.startsWith(`${named}~`);
  });

describe('roads reach the edge of the tile', () => {
  /**
   * Spec §9, invariant 1, asked from the ENTRY end.
   *
   * Fix round 4: this iterated `m.lanes.filter(isApron)` -- the aprons that
   * exist, not the entries that are owed one -- so an entry with NO apron
   * was invisible to it and a `main-street` spine's near end went on
   * stopping on the contract circle behind a green test. The subject of the
   * invariant is the entry; iterate that.
   *
   * "Reaches" is allowed to be TRANSITIVE, per §5.4.4 as generalised: an
   * apron that runs within `MERGE_CAPTURE_M` of one already drawn lands on
   * it and records a junction, so its entry reaches the tile edge via the
   * road it merged into. The walk below follows exactly those landings (a
   * merged apron's last point sits ON the survivor's polyline), and the
   * same hop covers a crossing split, whose outer half starts where the
   * inner half was cut.
   */
  it('every contract entry has a road that reaches the frame boundary', () => {
    each((m, label) => {
      const aprons = m.lanes.filter((l) => isApron(l.id));
      const reaches = (lane: typeof aprons[number], seen: Set<string>): boolean => {
        if (excusedByCoast(lane.id, m.diagnostics)) return true;
        if (onFrame(m, lane.points[lane.points.length - 1])) return true;
        seen.add(lane.id);
        const tip = lane.points[lane.points.length - 1];
        return aprons.some((other) => !seen.has(other.id)
          && toPolyline(tip.x, tip.y, other.points) <= 2
          && reaches(other, seen));
      };

      for (const entry of contractEntryPoints(m)) {
        const serving = aprons.filter(
          (a) => distance(a.points[0].x, a.points[0].y, entry.x, entry.y) <= ON_ENTRY_M,
        );
        expect(serving.length, `${label}: ${entry.label} has no apron at all — `
          + `its road still stops on the contract circle`).toBeGreaterThan(0);
        expect(serving.some((a) => reaches(a, new Set())),
          `${label}: ${entry.label} is served by ${serving.map((a) => a.id).join(', ')}, `
          + 'none of which gets to the frame').toBe(true);
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
        const excused = excusedByCoast(a.id, m.diagnostics);
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
