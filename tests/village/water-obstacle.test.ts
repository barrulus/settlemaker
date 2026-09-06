/**
 * Ship plan Phase 3 — narrow water is an obstacle, not a boundary.
 *
 * Three separate defects, each with its own bar below. Measured on the
 * `brook` (a 4 m stream through the green) and `strangled` (water on three
 * sides) failure-hunt scenarios before any fix:
 *
 *  - a 4 m brook stretched a pop-900 village to 7.41:1 against a dry
 *    baseline of about 2-3:1, because the radius profile caps every bearing
 *    at the shore whether the water is a sea or a stream you could step
 *    over;
 *  - houses stood IN the water -- up to 11 of 225 -- because `clipLots`
 *    tested only the frontage midpoint, so a lot whose ground was mostly
 *    river survived as long as its front point was dry;
 *  - the strangled site's farmland collapsed to 3.4k-9.5k m2 with no
 *    diagnostic saying so.
 */
import { describe, expect, it } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { inkExtent } from '../../src/village/glyphs.js';
import { inAnyWater } from '../../src/village/geometry.js';
import { Point } from '../../src/types/point.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import type { Building, VillageModel } from '../../src/village/types.js';

const flags = {
  port: false, citadel: false, walls: false, plaza: false,
  temple: false, shanty: false, capital: false,
};

/** A 4 m stream running NE-SW through the burg origin — AFMG's real river width. */
const brook = (population: number): AzgaarBurgInput => ({
  name: 'Brook', population, ...flags,
  roadBearings: [{ bearing_deg: 135, kind: 'main', through: true, route_id: 'r-cross' }],
  coastlineGeometry: [[
    { x: -900, y: -898 }, { x: 900, y: 902 }, { x: 900, y: 906 }, { x: -900, y: -894 },
  ]],
} as AzgaarBurgInput);

/** Dry twin of `brook`: same routes, same seeds, no water at all. */
const dry = (population: number): AzgaarBurgInput => ({
  name: 'Brook', population, ...flags,
  roadBearings: [{ bearing_deg: 135, kind: 'main', through: true, route_id: 'r-cross' }],
} as AzgaarBurgInput);

/** The four ink corners of a seated building. */
function inkCorners(b: Building): Point[] {
  const ink = inkExtent(b.glyph, b.footprint);
  const hw = ink.width / 2;
  const hd = ink.depth / 2;
  const r = (b.bearingDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Array<[number, number]>)
    .map(([x, y]) => new Point(b.position.x + x * c - y * s, b.position.y + x * s + y * c));
}

/**
 * Long/short axis ratio of the built fabric: the per-bearing p95 building
 * radius over 24 bins, smoothed with a 3-bin mean, max over min.
 *
 * Copied from `scripts/metrics-lib.ts`'s `buildingRadiusProfile` (scripts sit
 * outside the test tsconfig, so it cannot be imported) -- the same formula
 * the gate fixtures and the acceptance matrix are judged on.
 */
function anisotropyRatio(m: VillageModel): number {
  const BINS = 24;
  const c = m.green.centre;
  const per: number[][] = Array.from({ length: BINS }, () => []);
  for (const b of m.buildings) {
    const d = Math.hypot(b.position.x - c.x, b.position.y - c.y);
    const deg = ((Math.atan2(b.position.x - c.x, -(b.position.y - c.y)) * 180) / Math.PI + 360) % 360;
    per[Math.floor(deg / (360 / BINS)) % BINS].push(d);
  }
  const binR = per.map((xs) => (xs.length
    ? [...xs].sort((a, b) => a - b)[Math.floor(0.95 * (xs.length - 1))] : null));
  const smooth = binR
    .map((_, i) => {
      const w = [-1, 0, 1]
        .map((k) => binR[(i + k + BINS) % BINS])
        .filter((x): x is number => x !== null);
      return w.length ? w.reduce((sum, x) => sum + x, 0) / w.length : null;
    })
    .filter((x): x is number => x !== null);
  return smooth.length >= 2 ? Math.max(...smooth) / Math.min(...smooth) : NaN;
}

const housesInWater = (m: VillageModel): number => m.buildings.filter(
  (b) => inkCorners(b).some((p) => inAnyWater(p, m.site.water)),
).length;

describe('Phase 3: narrow water', () => {
  it('does not stretch a village into a sliver just because a stream crosses it', () => {
    // Stated against the village's OWN DRY TWIN rather than a fixed number:
    // the question is whether a 4 m stream DEFORMS the settlement, and the
    // honest control is the same village with the stream taken away.
    //
    // Measured before the fix (wet ratio / dry ratio): 1.07x, 2.23x, 3.12x,
    // 3.30x, 2.70x, 3.72x -- the brook was tripling the elongation, to an
    // absolute 7.00:1 at pop 900 seed 1. Elongation itself is wanted (the
    // standing bar asks for ratio >= 1.5); being stretched threefold by
    // something you could step over is not.
    for (const population of [300, 900]) {
      for (const seed of [1, 2, 3]) {
        const wet = anisotropyRatio(generateVillage(brook(population), seed));
        const control = anisotropyRatio(generateVillage(dry(population), seed));
        expect(wet, `pop ${population} seed ${seed}: brook stretched ${(wet / control).toFixed(2)}x`)
          .toBeLessThanOrEqual(control * 1.75);
      }
    }
  });

  it('never leaves a house standing in water', () => {
    // Tested on the INK FOOTPRINT, not the centre point. Measured before
    // the fix: brook 900 seed 1 had 11 houses in the stream while only 3 of
    // them had a wet CENTRE, so a centre test cannot see this defect --
    // which is the same blindness `clipLots` had.
    for (const population of [300, 900]) {
      for (const seed of [1, 2, 3]) {
        const m = generateVillage(brook(population), seed);
        expect(housesInWater(m), `brook pop ${population} seed ${seed}`).toBe(0);
      }
    }
  });

  it('marks every place a road crosses water, so nothing crosses unrecorded', () => {
    // Bullet 3, in its "mark the crossing" form. Full bridge GEOMETRY
    // belongs to the parked rivers work and is deliberately not attempted
    // here; what this phase owes is that a road crossing a stream is a
    // recorded fact on the model rather than a silent overlap.
    //
    // The village is now MORE likely to straddle the brook than before,
    // because it is no longer shoved aside by it — which is what a real
    // village does with a stream, and exactly why the crossings must be
    // marked rather than wished away.
    for (const population of [300, 900]) {
      for (const seed of [1, 2, 3]) {
        const m = generateVillage(brook(population), seed);
        const wetLanes = m.lanes.filter((l) => l.points.some((p) => inAnyWater(p, m.site.water)));
        if (wetLanes.length === 0) continue;
        expect(m.bridges.length, `brook pop ${population} seed ${seed}: wet lanes but no crossings`)
          .toBeGreaterThan(0);
        for (const b of m.bridges) {
          expect(m.lanes.some((l) => l.id === b.laneId),
            `crossing ${b.id} names a lane that is not in the model`).toBe(true);
          expect(b.spanM).toBeGreaterThan(0);
        }
        // Every crossing is on water, which is what makes it a crossing.
        for (const b of m.bridges) {
          expect(inAnyWater(b.position, m.site.water), `crossing ${b.id} is not on water`).toBe(true);
        }
      }
    }
  });

  it('records no crossing for a village with no water at all', () => {
    const m = generateVillage(dry(300), 1);
    expect(m.bridges).toEqual([]);
  });

  it('says so when water leaves a village almost no farmland', () => {
    // The strangled site: water on three sides, ~70 m of dry land. Farmland
    // collapses to a few thousand square metres against a normal ~130k, and
    // it used to do so in silence. Never silent, per the standing bars.
    const strangled: AzgaarBurgInput = {
      name: 'Strangled', population: 900, ...flags, port: true,
      roadBearings: [{ bearing_deg: 180, kind: 'main', route_id: 'r-neck' }],
      coastlineGeometry: [
        [{ x: 70, y: -900 }, { x: 900, y: -900 }, { x: 900, y: 900 }, { x: 70, y: 900 }],
        [{ x: -900, y: -900 }, { x: -70, y: -900 }, { x: -70, y: 900 }, { x: -900, y: 900 }],
        [{ x: -900, y: -900 }, { x: 900, y: -900 }, { x: 900, y: -70 }, { x: -900, y: -70 }],
      ],
    } as AzgaarBurgInput;
    const m = generateVillage(strangled, 1);
    expect(m.diagnostics.some((d) => d.startsWith('water:')),
      `no water diagnostic; got: ${m.diagnostics.join(' | ')}`).toBe(true);
  });
});
