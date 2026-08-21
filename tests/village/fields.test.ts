import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { pointInPolygon } from '../../src/geom/point-in-polygon.js';
import { SeededRandom } from '../../src/utils/random.js';
import { buildFields, buildWedges, fieldOuterRadius } from '../../src/village/dressing/fields.js';
import { generateVillage } from '../../src/village/village-model.js';
import { lotObb, obbOverlap } from '../../src/village/parcels/overlap.js';
import { closestPointOnSegment, dist, angularGap } from '../../src/village/geometry.js';
import {
  FIELD_BAND_DEPTH_MAX_M, FIELD_CROPS, FIELD_M2_PER_CAPITA, FURROW_MIN_LENGTH_M,
  FURROW_WIDTH_M, GREEN_JOIN_RATIO, LANE_SETBACK_M, RING_SETBACK_M,
} from '../../src/village/constants.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import type { Croft, Green, Lane, Lot, Site } from '../../src/village/types.js';

const site = (over: Partial<Site> = {}): Site => ({
  population: 400,
  biome: 'temperate',
  routes: [],
  water: [],
  flags: { port: false, temple: false, trade: false, walls: false },
  ...over,
});

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

const lane = (id: string, bearingDeg: number, len = 150, over: Partial<Lane> = {}): Lane => {
  const r = (bearingDeg * Math.PI) / 180;
  const dir = new Point(Math.sin(r), -Math.cos(r));
  return {
    // points[0] must NOT be the green centre itself -- bearingOf(centre,
    // centre) is degenerate (always 0) and would collapse every lane's
    // bearing. Real lanes start at the green's edge, so this fixture does
    // too (matches `Lane`'s own contract: "ordered from the green outward").
    id, type: 'local', widthM: 3.5,
    points: [new Point(dir.x * 11, dir.y * 11), new Point(dir.x * len, dir.y * len)],
    ...over,
  };
};

describe('buildWedges', () => {
  it('fails soft to one full-circle wedge with zero green-attached lanes', () => {
    const wedges = buildWedges(green, []);
    expect(wedges).toHaveLength(1);
    expect(wedges[0].id).toBe('wedge:none');
    expect(wedges[0].spanDeg).toBe(360);
  });

  it('fails soft to one full-circle wedge with exactly one green-attached lane', () => {
    const wedges = buildWedges(green, [lane('arm-090', 90)]);
    expect(wedges).toHaveLength(1);
    expect(wedges[0].id).toBe('wedge:arm-090|arm-090');
    expect(wedges[0].spanDeg).toBe(360);
  });

  it('ignores branch lanes (parentId set) as wedge bounds', () => {
    const branch = lane('arm-090/b50', 90, 40, { parentId: 'arm-090' });
    const wedges = buildWedges(green, [lane('arm-000', 0), branch]);
    // Only one real green-attached lane -> the fail-soft single-lane case.
    expect(wedges).toHaveLength(1);
    expect(wedges[0].id).toBe('wedge:arm-000|arm-000');
  });

  it('bounds one wedge per adjacent pair of green-attached lanes, sorted by bearing', () => {
    const wedges = buildWedges(green, [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)]);
    expect(wedges).toHaveLength(3);
    expect(wedges.map((w) => w.id)).toEqual([
      'wedge:arm-000|arm-090', 'wedge:arm-090|arm-200', 'wedge:arm-200|arm-000',
    ]);
    const totalSpan = wedges.reduce((s, w) => s + w.spanDeg, 0);
    expect(totalSpan).toBeCloseTo(360, 5);
  });
});

describe('fieldOuterRadius (fix round 1: census/fabric-driven band)', () => {
  it('gives a depth of exactly FURROW_WIDTH_M for zero population (the floor)', () => {
    expect(fieldOuterRadius(50, 0)).toBeCloseTo(50 + FURROW_WIDTH_M, 6);
  });

  it('depth grows with population, area matching the census demand', () => {
    const inner = 50;
    // Population chosen so the resulting depth stays under
    // FIELD_BAND_DEPTH_MAX_M (uncapped) -- otherwise the clamp, not the
    // area formula, would be what the assertion measures.
    const population = 200;
    const outer = fieldOuterRadius(inner, population);
    expect(outer - inner).toBeLessThan(FIELD_BAND_DEPTH_MAX_M);
    const area = Math.PI * (outer * outer - inner * inner);
    expect(area).toBeCloseTo(population * FIELD_M2_PER_CAPITA, 0);
  });

  it('clamps depth at FIELD_BAND_DEPTH_MAX_M for a huge census', () => {
    const inner = 50;
    const outer = fieldOuterRadius(inner, 10_000_000);
    expect(outer - inner).toBeCloseTo(FIELD_BAND_DEPTH_MAX_M, 6);
  });

  it('never returns less than innerRadius + FURROW_WIDTH_M (never a negative or zero-width band)', () => {
    for (const pop of [0, 1, 50, 300, 900, 5000]) {
      expect(fieldOuterRadius(80, pop)).toBeGreaterThanOrEqual(80 + FURROW_WIDTH_M - 1e-9);
    }
  });
});

describe('buildFields', () => {
  const emptyLots: Lot[] = [];
  const emptyCrofts: Croft[] = [];

  it('strips within one wedge (bundle) all share the same furrow direction', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const rng = new SeededRandom(1);
    const { strips } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, 'hedge', rng);
    const byWedge = new Map<string, number[]>();
    for (const s of strips) {
      const arr = byWedge.get(s.wedgeId) ?? [];
      arr.push(s.furrowBearingDeg);
      byWedge.set(s.wedgeId, arr);
    }
    expect(byWedge.size).toBeGreaterThan(0);
    for (const bearings of byWedge.values()) {
      for (const b of bearings) expect(b).toBeCloseTo(bearings[0], 6);
    }
  });

  it('adjacent bundles (two opposite lanes) use directions ~90deg apart, modulo jitter', () => {
    // Two lanes at 0/180 -> two wedges, bisectors 90 and 270. idx0 (even)
    // uses its own bisector (90); idx1 (odd) uses bisector+90 (270+90=0/
    // 360). The two base directions are exactly 90deg apart before jitter.
    const lanes = [lane('arm-000', 0), lane('arm-180', 180)];
    const rng = new SeededRandom(3);
    const { strips } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, 'hedge', rng);
    const byWedge = new Map<string, number>();
    for (const s of strips) byWedge.set(s.wedgeId, s.furrowBearingDeg);
    expect(byWedge.size).toBe(2);
    const [a, b] = [...byWedge.values()];
    const gap = angularGap(a, b);
    // 90deg apart, +/- the two wedges' independent jitter draws (max 15 each).
    expect(gap).toBeGreaterThan(90 - 15 - 15 - 1);
    expect(gap).toBeLessThan(90 + 15 + 15 + 1);
  });

  it('every strip furrow direction sits within the jitter range of its alternated bisector', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const wedges = buildWedges(green, lanes).slice().sort((x, y) => x.id.localeCompare(y.id));
    const rng = new SeededRandom(9);
    const { strips } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, 'hedge', rng);
    const byWedge = new Map<string, number>();
    for (const s of strips) byWedge.set(s.wedgeId, s.furrowBearingDeg);
    wedges.forEach((w, idx) => {
      const bearing = byWedge.get(w.id);
      if (bearing === undefined) return; // wedge produced no kept strips
      const base = idx % 2 === 0 ? w.bisectorDeg : w.bisectorDeg + 90;
      expect(angularGap(bearing, base)).toBeLessThanOrEqual(15 + 1e-6);
    });
  });

  it('emits ids as field:<wedgeId>:S<i>', () => {
    const lanes = [lane('arm-090', 90), lane('arm-270', 270)];
    const rng = new SeededRandom(5);
    const { strips } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, 'hedge', rng);
    expect(strips.length).toBeGreaterThan(0);
    for (const s of strips) {
      expect(s.id).toBe(`field:${s.wedgeId}:S${s.id.split(':S')[1]}`);
      expect(s.id.startsWith(`field:${s.wedgeId}:S`)).toBe(true);
      expect(/^field:.+:S\d+$/.test(s.id)).toBe(true);
    }
  });

  it('drops fragments shorter than FURROW_MIN_LENGTH_M (no strip is a sliver)', () => {
    const lanes = [lane('arm-090', 90), lane('arm-270', 270)];
    const rng = new SeededRandom(11);
    const { strips } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, 'hedge', rng);
    for (const s of strips) {
      // Rough check: opposite polygon edges (the strip's length axis) must
      // clear the minimum length.
      const len = Math.max(dist(s.polygon[0], s.polygon[1]), dist(s.polygon[1], s.polygon[2]));
      expect(len).toBeGreaterThanOrEqual(FURROW_MIN_LENGTH_M - 1e-6);
    }
  });

  // Fix round 1 (2026-08-21): the gate used to be `builtRadiusM *
  // FIELD_RADIUS_FACTOR > innerRadius`, which the real pipeline's frontage
  // escalation loop closed in EVERY fixture (the actual fabric routinely
  // outgrows the prediction). The band now floors at FURROW_WIDTH_M deep
  // regardless of population, so the only genuine "no fields" case left is
  // the whole band being walled off -- exercised here with water covering
  // every sampled point.
  it('is empty (fails soft) when the field band is entirely walled off', () => {
    const bigWater = [[
      new Point(-1000, -1000), new Point(1000, -1000), new Point(1000, 1000), new Point(-1000, 1000),
    ]];
    const lanes = [lane('arm-090', 90), lane('arm-270', 270)];
    const rng = new SeededRandom(1);
    const { strips } = buildFields(site({ water: bigWater }), green, lanes, emptyLots, emptyCrofts, 'hedge', rng);
    expect(strips).toEqual([]);
  });

  it('never throws with zero lanes, zero lots, zero crofts', () => {
    const rng = new SeededRandom(1);
    expect(() => buildFields(site(), green, [], [], [], 'hedge', rng)).not.toThrow();
  });

  it('tundra biome only ever uses pasture crops', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const rng = new SeededRandom(2);
    const { strips } = buildFields(
      site({ biome: 'tundra' }), green, lanes, emptyLots, emptyCrofts, 'hedge', rng,
    );
    expect(strips.length).toBeGreaterThan(0);
    for (const s of strips) expect(s.glyph).toBe('sm-field-pasture');
  });

  it('temperate biome only cycles the temperate crop table (plus orchard/vine)', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const rng = new SeededRandom(2);
    const { strips } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, 'hedge', rng);
    const allowed = new Set([...FIELD_CROPS.temperate, 'sm-field-orchard', 'sm-field-vine']);
    for (const s of strips) expect(allowed.has(s.glyph)).toBe(true);
  });

  it('is deterministic: same inputs and seed produce identical output', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const a = buildFields(site(), green, lanes, emptyLots, emptyCrofts, 'hedge', new SeededRandom(77));
    const b = buildFields(site(), green, lanes, emptyLots, emptyCrofts, 'hedge', new SeededRandom(77));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('buildFields geometric invariants (real village fixtures)', () => {
  const water = [[{ x: 60, y: -200 }, { x: 400, y: -200 }, { x: 400, y: 400 }, { x: 60, y: 400 }]]
    .map((ring) => ring.map((p) => new Point(p.x, p.y)));

  const inputs: AzgaarBurgInput[] = [
    { name: 'A', population: 300, port: false, citadel: false, walls: false, plaza: false,
      temple: false, shanty: false, capital: false, roadBearings: [90, 200, 300] },
    { name: 'B', population: 500, port: true, citadel: false, walls: false, plaza: false,
      temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 0, kind: 'road', through: true }, { bearing_deg: 140, kind: 'foot' }],
      coastlineGeometry: water },
    { name: 'C', population: 150, port: false, citadel: false, walls: false, plaza: false,
      temple: false, shanty: false, capital: false, biome: 'tundra', roadBearings: [90] },
  ];

  const pointInAnyLotClaim = (p: Point, lots: Lot[]): boolean => {
    const pointObb = {
      center: p, tangent: new Point(1, 0), normal: new Point(0, 1), halfW: 0, halfD: 0,
    };
    return lots.some((l) => obbOverlap(pointObb, lotObb(l), 0));
  };

  const pointInAnyCroft = (p: Point, crofts: Croft[]): boolean => crofts.some((c) => pointInPolygon(p, c.polygon));

  const pointInAnyLaneCorridor = (p: Point, lanes: Lane[]): boolean => lanes.some((l) => {
    if (l.points.length < 2) return false;
    const clearance = l.widthM / 2 + (LANE_SETBACK_M[l.type] ?? 2);
    for (let i = 1; i < l.points.length; i++) {
      const q = closestPointOnSegment(p, l.points[i - 1], l.points[i]);
      if (dist(p, q) <= clearance) return true;
    }
    return false;
  });

  const pointInAnyWater = (p: Point, w: Point[][]): boolean => w.some((ring) => pointInPolygon(p, ring));

  it('no field strip polygon point falls inside a croft, lot claim, lane corridor, green, or water', () => {
    for (const input of inputs) {
      for (const seed of [1, 2, 3]) {
        const m = generateVillage(input, seed);
        const greenRadius = (m.green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
        for (const strip of m.fields) {
          for (const p of strip.polygon) {
            expect(pointInAnyCroft(p, m.crofts)).toBe(false);
            expect(pointInAnyLotClaim(p, m.lots)).toBe(false);
            expect(pointInAnyLaneCorridor(p, m.lanes)).toBe(false);
            expect(pointInAnyWater(p, m.site.water)).toBe(false);
            expect(dist(p, m.green.centre)).toBeGreaterThanOrEqual(greenRadius - 1e-6);
          }
        }
      }
    }
  }, 20000);

  it('is deterministic through the full generateVillage pipeline', () => {
    for (const input of inputs) {
      const a = generateVillage(input, 42).fields;
      const b = generateVillage(input, 42).fields;
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('never throws end to end, including a bare/degenerate input', () => {
    const bare: AzgaarBurgInput = {
      name: 'Bare', population: 12, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
    };
    expect(() => generateVillage(bare, 1)).not.toThrow();
    const m = generateVillage(bare, 1);
    expect(Array.isArray(m.fields)).toBe(true);
  });

  // Fix round 1 regression net (2026-08-21): a post-completion probe over
  // the real pipeline found `fields` empty in every one of 14 fixtures --
  // the gate closed because the escalation loop routinely grows the real
  // fabric past the PREDICTED builtRadius. This is the guard that would
  // have caught it: a plausible village of real size must produce at
  // least one field strip through the actual generateVillage pipeline,
  // not just the hand-built unit fixtures above.
  it('produces at least one field strip through the real pipeline (pop 300 and pop 900)', () => {
    const popInput = (population: number): AzgaarBurgInput => ({
      name: 'Regression', population, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    });
    expect(generateVillage(popInput(300), 1).fields.length).toBeGreaterThan(0);
    expect(generateVillage(popInput(900), 1).fields.length).toBeGreaterThan(0);
  });
});
