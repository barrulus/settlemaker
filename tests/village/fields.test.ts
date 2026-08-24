import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { pointInPolygon } from '../../src/geom/point-in-polygon.js';
import { SeededRandom } from '../../src/utils/random.js';
import {
  blockOuterRadius, buildFields, buildWedges, ringRows,
} from '../../src/village/dressing/fields.js';
import { generateVillage } from '../../src/village/village-model.js';
import { lotObb, obbOverlap } from '../../src/village/parcels/overlap.js';
import { closestPointOnSegment, dist, angularGap } from '../../src/village/geometry.js';
import {
  FIELD_BLOCK_DEPTH_MAX_M, FIELD_DEPTH_JITTER, FIELD_BLOCK_DEPTH_MIN_M, FIELD_CROPS, FIELD_MIN_BLOCK_AREA_M2,
  FIELD_BLOCK_MIN_ASPECT, FIELD_BLOCK_ROW_DEPTH_TARGET_M, FIELD_BLOCK_ROW_GAP_M, FIELD_BLOCK_ROWS_MAX,
  GREEN_JOIN_RATIO, LANE_SETBACK_M, RING_SETBACK_M,
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

describe('blockOuterRadius (gate 5: census-driven ring depth)', () => {
  const FULL = 2 * Math.PI;

  it('gives a depth of exactly FIELD_BLOCK_DEPTH_MIN_M for zero demand (the floor)', () => {
    expect(blockOuterRadius(50, 0, FULL)).toBeCloseTo(50 + FIELD_BLOCK_DEPTH_MIN_M, 6);
  });

  it('the swept sector area matches the demand asked for', () => {
    const inner = 120;
    const coverage = FULL * 0.8; // a ring with 20% of its span left as green
    // Demand chosen so the depth lands inside the clamp, otherwise the
    // clamp -- not the area formula -- is what the assertion measures.
    const demand = 60_000;
    const outer = blockOuterRadius(inner, demand, coverage);
    expect(outer - inner).toBeGreaterThan(FIELD_BLOCK_DEPTH_MIN_M);
    expect(outer - inner).toBeLessThan(FIELD_BLOCK_DEPTH_MAX_M);
    const swept = (coverage / 2) * (outer * outer - inner * inner);
    expect(swept).toBeCloseTo(demand, 0);
  });

  it('sizes against COVERAGE, not the full span: a gappier ring runs deeper', () => {
    const inner = 120;
    const demand = 60_000;
    const full = blockOuterRadius(inner, demand, FULL);
    const gappy = blockOuterRadius(inner, demand, FULL * 0.8);
    expect(gappy).toBeGreaterThan(full);
  });

  it('clamps depth at FIELD_BLOCK_DEPTH_MAX_M for a huge census', () => {
    expect(blockOuterRadius(50, 10_000_000, FULL) - 50).toBeCloseTo(FIELD_BLOCK_DEPTH_MAX_M, 6);
  });

  it('never returns a band shallower than the floor, at any demand', () => {
    for (const demand of [0, 1, 5_000, 50_000, 500_000]) {
      expect(blockOuterRadius(80, demand, FULL)).toBeGreaterThanOrEqual(
        80 + FIELD_BLOCK_DEPTH_MIN_M - 1e-9,
      );
    }
  });
});

describe('buildFields', () => {
  const emptyLots: Lot[] = [];
  const emptyCrofts: Croft[] = [];

  it('blocks within one wedge all share the same furrow direction', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const rng = new SeededRandom(1);
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, rng);
    const byWedge = new Map<string, number[]>();
    for (const s of blocks) {
      const arr = byWedge.get(s.wedgeId) ?? [];
      arr.push(s.furrowBearingDeg);
      byWedge.set(s.wedgeId, arr);
    }
    expect(byWedge.size).toBeGreaterThan(0);
    for (const bearings of byWedge.values()) {
      for (const b of bearings) expect(b).toBeCloseTo(bearings[0], 6);
    }
  });

  it('adjacent wedges (two opposite lanes) use directions ~90deg apart, modulo jitter', () => {
    // Two lanes at 0/180 -> two wedges, bisectors 90 and 270. idx0 (even)
    // uses its own bisector (90); idx1 (odd) uses bisector+90 (270+90=0/
    // 360). The two base directions are exactly 90deg apart before jitter.
    const lanes = [lane('arm-000', 0), lane('arm-180', 180)];
    const rng = new SeededRandom(3);
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, rng);
    const byWedge = new Map<string, number>();
    for (const s of blocks) byWedge.set(s.wedgeId, s.furrowBearingDeg);
    expect(byWedge.size).toBe(2);
    const [a, b] = [...byWedge.values()];
    const gap = angularGap(a, b);
    // 90deg apart, +/- the two wedges' independent jitter draws (max 15 each).
    expect(gap).toBeGreaterThan(90 - 15 - 15 - 1);
    expect(gap).toBeLessThan(90 + 15 + 15 + 1);
  });

  it('every block furrow direction sits within the jitter range of its alternated bisector', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const wedges = buildWedges(green, lanes).slice().sort((x, y) => x.id.localeCompare(y.id));
    const rng = new SeededRandom(9);
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, rng);
    const byWedge = new Map<string, number>();
    for (const s of blocks) byWedge.set(s.wedgeId, s.furrowBearingDeg);
    wedges.forEach((w, idx) => {
      const bearing = byWedge.get(w.id);
      if (bearing === undefined) return; // wedge produced no kept blocks
      const base = idx % 2 === 0 ? w.bisectorDeg : w.bisectorDeg + 90;
      expect(angularGap(bearing, base)).toBeLessThanOrEqual(15 + 1e-6);
    });
  });

  // Gate 5: one block per kept angular run, ordinal within its wedge.
  it('emits ids as field:<wedgeId>:S<i>, unique within a wedge', () => {
    const lanes = [lane('arm-090', 90), lane('arm-270', 270)];
    const rng = new SeededRandom(5);
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, rng);
    expect(blocks.length).toBeGreaterThan(0);
    for (const s of blocks) {
      expect(s.id.startsWith(`field:${s.wedgeId}:S`)).toBe(true);
      expect(/^field:.+:S\d+$/.test(s.id)).toBe(true);
    }
    expect(new Set(blocks.map((s) => s.id)).size).toBe(blocks.length);
  });

  // Gate 5 replaces the old "no strip is a sliver" length rule: a block is
  // culled below FIELD_MIN_BLOCK_AREA_M2, and is always at least the depth
  // floor deep, so it reads as a chunky field rather than a ribbon.
  it('keeps no block below FIELD_MIN_BLOCK_AREA_M2, and none outside the COURSE depth range', () => {
    const lanes = [lane('arm-090', 90), lane('arm-270', 270)];
    const rng = new SeededRandom(11);
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, rng);
    expect(blocks.length).toBeGreaterThan(0);
    // GATE 8.1 RESTATES THIS PREMISE, which is genuinely false now.
    //
    // It used to read "none thinner than FIELD_BLOCK_DEPTH_MIN_M less the
    // jitter". That constant no longer describes a BLOCK: it clamps the
    // depth of the whole RING, which is then cut into courses (`ringRows`)
    // so that a block's depth is comparable to its arc width. A block at
    // pop 400 is now ~33 m deep, not ~110, and asserting the old bound
    // would be asserting the petal the owner rejected.
    //
    // What is still true, and is what this pins: a block's depth is one
    // COURSE of a ring whose total depth is inside the old clamp, plus the
    // jitter. The bound is derived from `ringRows` over the clamp range
    // rather than written down, because the row count steps (a deeper ring
    // gets MORE courses and therefore SHALLOWER blocks, so the extremes are
    // not at the ends of the range).
    let minRow = Infinity;
    let maxRow = 0;
    for (let d = FIELD_BLOCK_DEPTH_MIN_M; d <= FIELD_BLOCK_DEPTH_MAX_M; d += 0.5) {
      const { rowDepth } = ringRows(d);
      minRow = Math.min(minRow, rowDepth);
      maxRow = Math.max(maxRow, rowDepth);
    }
    for (const s of blocks) {
      expect(s.areaM2).toBeGreaterThanOrEqual(FIELD_MIN_BLOCK_AREA_M2);
      // Radial depth: the polygon is the outer arc forward then the inner
      // arc back, so first and last points share a bearing.
      const outerR = dist(s.polygon[0], green.centre);
      const innerR = dist(s.polygon[s.polygon.length - 1], green.centre);
      expect(outerR - innerR).toBeGreaterThanOrEqual(minRow * (1 - FIELD_DEPTH_JITTER) - 1e-6);
      expect(outerR - innerR).toBeLessThanOrEqual(maxRow * (1 + FIELD_DEPTH_JITTER) + 1e-6);
    }
  });

  // GATE 8.1: the two rules that stop the ring reading as a pinwheel of
  // petals, asserted on real geometry rather than on the constants.
  it('keeps no block that is a radial sliver (FIELD_BLOCK_MIN_ASPECT)', () => {
    const lanes = [lane('arm-090', 90), lane('arm-270', 270), lane('arm-000', 0)];
    const rng = new SeededRandom(7);
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, rng);
    expect(blocks.length).toBeGreaterThan(0);
    for (const s of blocks) {
      const n = s.polygon.length;
      const outerR = dist(s.polygon[0], green.centre);
      const innerR = dist(s.polygon[n - 1], green.centre);
      // Arc width at the mid radius, from the polygon's own end bearings.
      const a = s.polygon[0];
      const b = s.polygon[n / 2 - 1];
      const spanRad = Math.abs(angularGap(
        (Math.atan2(a.x, -a.y) * 180) / Math.PI, (Math.atan2(b.x, -b.y) * 180) / Math.PI,
      ) * Math.PI) / 180;
      const arcW = spanRad * ((innerR + outerR) / 2);
      expect(arcW).toBeGreaterThanOrEqual(FIELD_BLOCK_MIN_ASPECT * (outerR - innerR) - 1e-6);
    }
  });

  it('ringRows partitions the ring depth exactly, into courses near the target depth', () => {
    for (let d = FIELD_BLOCK_DEPTH_MIN_M; d <= FIELD_BLOCK_DEPTH_MAX_M; d += 0.5) {
      const { rows, rowDepth, gap } = ringRows(d);
      expect(rows).toBeGreaterThanOrEqual(1);
      expect(rows).toBeLessThanOrEqual(FIELD_BLOCK_ROWS_MAX);
      expect(gap).toBe(rows > 1 ? FIELD_BLOCK_ROW_GAP_M : 0);
      // Exact partition: the census bought this depth and the courses spend
      // all of it, headlands included. Nothing is invented and nothing lost.
      expect(rows * rowDepth + gap * (rows - 1)).toBeCloseTo(d, 6);
      // And a course is a field-sized thing, not a slab: within a factor of
      // two of the target either way across the whole clamp range.
      expect(rowDepth).toBeGreaterThan(FIELD_BLOCK_ROW_DEPTH_TARGET_M / 2);
      expect(rowDepth).toBeLessThan(FIELD_BLOCK_ROW_DEPTH_TARGET_M * 2);
    }
  });

  // The depth clamp guarantees a positive band at any census, so the only
  // genuine "no fields" case left is the ring being walled off entirely --
  // exercised here with water covering every sampled point.
  it('is empty (fails soft) when the ring is entirely walled off', () => {
    const bigWater = [[
      new Point(-1000, -1000), new Point(1000, -1000), new Point(1000, 1000), new Point(-1000, 1000),
    ]];
    const lanes = [lane('arm-090', 90), lane('arm-270', 270)];
    const rng = new SeededRandom(1);
    const { blocks } = buildFields(site({ water: bigWater }), green, lanes, emptyLots, emptyCrofts, rng);
    expect(blocks).toEqual([]);
  });

  it('never throws with zero lanes, zero lots, zero crofts', () => {
    const rng = new SeededRandom(1);
    expect(() => buildFields(site(), green, [], [], [], rng)).not.toThrow();
  });

  it('tundra biome only ever uses pasture crops', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const rng = new SeededRandom(2);
    const { blocks } = buildFields(
      site({ biome: 'tundra' }), green, lanes, emptyLots, emptyCrofts, rng,
    );
    expect(blocks.length).toBeGreaterThan(0);
    for (const s of blocks) expect(s.glyph).toBe('sm-field-pasture');
  });

  it('temperate biome only cycles the temperate crop table (plus orchard/vine)', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const rng = new SeededRandom(2);
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, rng);
    const allowed = new Set([...FIELD_CROPS.temperate, 'sm-field-orchard', 'sm-field-vine']);
    for (const s of blocks) expect(allowed.has(s.glyph)).toBe(true);
  });

  it('is deterministic: same inputs and seed produce identical output', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const a = buildFields(site(), green, lanes, emptyLots, emptyCrofts, new SeededRandom(77));
    const b = buildFields(site(), green, lanes, emptyLots, emptyCrofts, new SeededRandom(77));
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

  it('no field block polygon point falls inside a croft, lot claim, lane corridor, green, or water', () => {
    for (const input of inputs) {
      for (const seed of [1, 2, 3]) {
        const m = generateVillage(input, seed);
        const greenRadius = (m.green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
        for (const block of m.fields) {
          for (const p of block.polygon) {
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
  // least one field block through the actual generateVillage pipeline,
  // not just the hand-built unit fixtures above.
  it('produces at least one field block through the real pipeline (pop 300 and pop 900)', () => {
    const popInput = (population: number): AzgaarBurgInput => ({
      name: 'Regression', population, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    });
    expect(generateVillage(popInput(300), 1).fields.length).toBeGreaterThan(0);
    expect(generateVillage(popInput(900), 1).fields.length).toBeGreaterThan(0);
  });

  // Fix wave regression net (2026-08-21, I2): furrow alternation used to be
  // keyed to the wedge's LEXICAL id rank, which has nothing to do with where
  // the wedge sits, so "alternating" bundles were only alternating on paper
  // -- 28% of spatially adjacent pairs came out within 15 degrees of
  // parallel. Spatial adjacency is what matters: two neighbouring bundles
  // whose furrows run the same way read as one smeared field, which is the
  // seam the alternation exists to break. Parity now comes from the
  // BEARING-sorted rank, so this holds; on the pre-fix code it does not.
  it('no two spatially adjacent wedges run their furrows within 15deg of parallel', () => {
    const popInput = (population: number, bearings: number[]): AzgaarBurgInput => ({
      name: 'Adjacency', population, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: bearings.map((b) => ({ bearing_deg: b, kind: 'road' as const })),
    });
    let checked = 0;
    for (const input of [popInput(300, [225]), popInput(600, [0, 120, 240]), popInput(900, [45, 200])]) {
      for (const seed of [1, 2, 3]) {
        const m = generateVillage(input, seed);
        // Furrow bearing per wedge, taken from its blocks (all blocks in a
        // wedge share one bearing -- asserted separately above).
        const bearingByWedge = new Map<string, number>();
        for (const s of m.fields) bearingByWedge.set(s.wedgeId, s.furrowBearingDeg);
        // Spatial adjacency: consecutive wedges in `buildWedges`'s own
        // bearing-sorted output, wrap included.
        const wedges = buildWedges(m.green, m.lanes);
        for (let i = 0; i < wedges.length; i++) {
          const a = bearingByWedge.get(wedges[i].id);
          const b = bearingByWedge.get(wedges[(i + 1) % wedges.length].id);
          if (a === undefined || b === undefined || wedges.length < 2) continue;
          // Furrows are undirected: 179deg and 359deg are the same run.
          const gap = angularGap(a, b) % 180;
          const fromParallel = Math.min(gap, 180 - gap);
          checked += 1;
          expect(fromParallel).toBeGreaterThan(15);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 20000);
});
