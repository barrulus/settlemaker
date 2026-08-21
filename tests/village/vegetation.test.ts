import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { pointInPolygon } from '../../src/geom/point-in-polygon.js';
import { SeededRandom } from '../../src/utils/random.js';
import { buildVegetation } from '../../src/village/dressing/vegetation.js';
import { generateVillage } from '../../src/village/village-model.js';
import { hasGlyph } from '../../src/village/glyphs.js';
import { lotObb, obbOverlap } from '../../src/village/parcels/overlap.js';
import { closestPointOnSegment, dist } from '../../src/village/geometry.js';
import {
  CLUMP_RADIUS_M, GREEN_JOIN_RATIO, RING_SETBACK_M, SHOREFRONT_BAND_M,
  SHOREFRONT_REACH_FACTOR, VEG_GLYPHS, VEG_LANE_CLEAR_M, VEG_SCALE_MAX, VEG_SCALE_MIN,
} from '../../src/village/constants.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import type {
  Croft, FieldStrip, Green, Lane, Lot, Site,
} from '../../src/village/types.js';

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
    id, type: 'local', widthM: 3.5,
    points: [new Point(dir.x * 11, dir.y * 11), new Point(dir.x * len, dir.y * len)],
    ...over,
  };
};

const emptyLots: Lot[] = [];
const emptyCrofts: Croft[] = [];
const emptyFields: FieldStrip[] = [];

describe('buildVegetation', () => {
  it('is deterministic: same inputs and seed produce identical output', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const a = buildVegetation(
      site(), green, lanes, emptyLots, emptyCrofts, emptyFields, 40, new SeededRandom(77),
    );
    const b = buildVegetation(
      site(), green, lanes, emptyLots, emptyCrofts, emptyFields, 40, new SeededRandom(77),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('never throws with zero lanes, zero lots, zero crofts, zero fields', () => {
    const rng = new SeededRandom(1);
    expect(() => buildVegetation(
      site(), green, [], [], [], [], 40, rng,
    )).not.toThrow();
  });

  it('produces some trees for a plausible built radius', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const trees = buildVegetation(
      site(), green, lanes, emptyLots, emptyCrofts, emptyFields, 40, new SeededRandom(5),
    );
    expect(trees.length).toBeGreaterThan(0);
  });

  it('emits ids as veg:<cellX>x<cellY>, and clump children as veg:<cellX>x<cellY>:<j>', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const trees = buildVegetation(
      site(), green, lanes, emptyLots, emptyCrofts, emptyFields, 40, new SeededRandom(5),
    );
    expect(trees.length).toBeGreaterThan(0);
    const parentIds = new Set<string>();
    for (const t of trees) {
      expect(/^veg:-?\d+x-?\d+(:\d+)?$/.test(t.id)).toBe(true);
      if (!t.id.includes(':', 4)) parentIds.add(t.id);
    }
    // At least one clump child, whose parent id is also present.
    const children = trees.filter((t) => /^veg:-?\d+x-?\d+:\d+$/.test(t.id));
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) {
      const parentId = c.id.slice(0, c.id.lastIndexOf(':'));
      expect(trees.some((t) => t.id === parentId)).toBe(true);
    }
  });

  it('every clump child lies within CLUMP_RADIUS_M of its parent (uniform-in-disc, not a square)', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    let checkedAny = false;
    for (let seed = 1; seed <= 10; seed++) {
      const trees = buildVegetation(
        site(), green, lanes, emptyLots, emptyCrofts, emptyFields, 40, new SeededRandom(seed),
      );
      const byId = new Map(trees.map((t) => [t.id, t]));
      for (const t of trees) {
        const isChild = /^veg:-?\d+x-?\d+:\d+$/.test(t.id);
        if (!isChild) continue;
        const parent = byId.get(t.id.slice(0, t.id.lastIndexOf(':')));
        expect(parent).toBeDefined();
        checkedAny = true;
        expect(dist(t.position, parent!.position)).toBeLessThanOrEqual(CLUMP_RADIUS_M + 1e-9);
      }
    }
    expect(checkedAny).toBe(true);
  });

  it('scale jitter stays within VEG_SCALE_MIN..VEG_SCALE_MAX', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const trees = buildVegetation(
      site(), green, lanes, emptyLots, emptyCrofts, emptyFields, 40, new SeededRandom(9),
    );
    expect(trees.length).toBeGreaterThan(0);
    for (const t of trees) {
      expect(t.scale).toBeGreaterThanOrEqual(VEG_SCALE_MIN);
      expect(t.scale).toBeLessThanOrEqual(VEG_SCALE_MAX);
    }
  });

  it('density falls with distance from the fabric edge (binned counts, generous tolerance)', () => {
    const builtRadiusM = 40;
    // No lanes/fields: fabric edge (innerEdge) == builtRadiusM, scatter rim
    // == builtRadiusM * VEG_RADIUS_FACTOR (1.8). §7.3: densest at the
    // fabric edge, thinning to the rim -- so the half of the scatter band
    // closer to the fabric edge should carry noticeably more trees than
    // the half closer to the rim.
    const innerEdge = builtRadiusM;
    const rim = builtRadiusM * 1.8; // VEG_RADIUS_FACTOR
    const mid = (innerEdge + rim) / 2;
    let near = 0;
    let far = 0;
    for (const seed of [1, 2, 3, 55]) {
      const trees = buildVegetation(
        site(), green, [], emptyLots, emptyCrofts, emptyFields, builtRadiusM, new SeededRandom(seed),
      );
      for (const t of trees) {
        const d = dist(t.position, green.centre);
        if (d >= innerEdge && d < mid) near += 1;
        else if (d >= mid && d < rim) far += 1;
      }
    }
    expect(near + far).toBeGreaterThan(20);
    expect(near).toBeGreaterThan(far);
  });
});

describe('VEG_GLYPHS biome mixes', () => {
  it('every glyph id exists in the manifest', () => {
    for (const entries of Object.values(VEG_GLYPHS)) {
      for (const e of entries) expect(hasGlyph(e.glyph)).toBe(true);
    }
  });
});

describe('vegetation geometric invariants (real village fixtures)', () => {
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

  const pointInAnyField = (p: Point, fields: FieldStrip[]): boolean => fields.some(
    (f) => pointInPolygon(p, f.polygon),
  );

  const pointInAnyLaneCorridor = (p: Point, lanes: Lane[]): boolean => lanes.some((l) => {
    if (l.points.length < 2) return false;
    const clearance = l.widthM / 2 + VEG_LANE_CLEAR_M;
    for (let i = 1; i < l.points.length; i++) {
      const q = closestPointOnSegment(p, l.points[i - 1], l.points[i]);
      if (dist(p, q) <= clearance) return true;
    }
    return false;
  });

  const pointInAnyWater = (p: Point, w: Point[][]): boolean => w.some((ring) => pointInPolygon(p, ring));

  it('no tree falls on a lane corridor, lot claim, croft, field strip, the green, or water', () => {
    for (const input of inputs) {
      for (const seed of [1, 2, 3]) {
        const m = generateVillage(input, seed);
        const greenRadius = (m.green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
        for (const tree of m.vegetation) {
          const p = tree.position;
          expect(pointInAnyCroft(p, m.crofts)).toBe(false);
          expect(pointInAnyField(p, m.fields)).toBe(false);
          expect(pointInAnyLotClaim(p, m.lots)).toBe(false);
          expect(pointInAnyLaneCorridor(p, m.lanes)).toBe(false);
          expect(pointInAnyWater(p, m.site.water)).toBe(false);
          expect(dist(p, m.green.centre)).toBeGreaterThanOrEqual(greenRadius - 1e-6);
        }
      }
    }
  }, 20000);

  it('is deterministic through the full generateVillage pipeline', () => {
    for (const input of inputs) {
      const a = generateVillage(input, 42).vegetation;
      const b = generateVillage(input, 42).vegetation;
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
    expect(Array.isArray(m.vegetation)).toBe(true);
  });

});

describe('shorefront suppression (§8.4, coastal fixture)', () => {
  // Water starts 15 m east of the green -- close enough that the ordinary
  // scatter band overlaps it, so this fixture actually exercises the rule
  // rather than the water sitting harmlessly outside VEG_RADIUS_FACTOR.
  const water = [[
    { x: 15, y: -200 }, { x: 200, y: -200 }, { x: 200, y: 200 }, { x: 15, y: 200 },
  ].map((p) => new Point(p.x, p.y))];
  const coastalSite = site({ water, biome: 'coastal' });
  const builtRadiusM = 30;
  const reach = builtRadiusM * SHOREFRONT_REACH_FACTOR;

  const nearestWaterEdge = (p: Point): number => {
    let best = Infinity;
    for (const ring of water) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        best = Math.min(best, dist(p, closestPointOnSegment(p, a, b)));
      }
    }
    return best;
  };

  it('no tree within SHOREFRONT_BAND_M of the water edge, within reach of the green', () => {
    let checked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const trees = buildVegetation(
        coastalSite, green, [], emptyLots, emptyCrofts, emptyFields, builtRadiusM, new SeededRandom(seed),
      );
      for (const tree of trees) {
        const d = dist(tree.position, green.centre);
        if (d > reach) continue;
        checked += 1;
        expect(nearestWaterEdge(tree.position)).toBeGreaterThan(SHOREFRONT_BAND_M);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('beyond the shorefront reach, ordinary scatter resumes close to the water edge', () => {
    let allowedNearWater = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const trees = buildVegetation(
        coastalSite, green, [], emptyLots, emptyCrofts, emptyFields, builtRadiusM, new SeededRandom(seed),
      );
      for (const tree of trees) {
        const d = dist(tree.position, green.centre);
        if (d > reach && nearestWaterEdge(tree.position) <= SHOREFRONT_BAND_M) allowedNearWater += 1;
      }
    }
    expect(allowedNearWater).toBeGreaterThan(0);
  });
});
