import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { pointInPolygon } from '../../src/geom/point-in-polygon.js';
import { SeededRandom } from '../../src/utils/random.js';
import {
  beltPolygon, buildFields, clipOutsideBelt, exitRoads, regionHull,
} from '../../src/village/dressing/fields.js';
import { circularExtent, radialExtent } from '../../src/village/dressing/extent.js';
import { convexHull, longAxisDeg, polygonArea } from '../../src/village/dressing/parcel-cut.js';
import { generateVillage } from '../../src/village/village-model.js';
import { lotObb, obbOverlap } from '../../src/village/parcels/overlap.js';
import { closestPointOnSegment, dist, angularGap } from '../../src/village/geometry.js';
import {
  FIELD_BELT_JITTER_MAX_M, FIELD_BELT_JITTER_MIN_M, FIELD_CROPS, FIELD_JITTER_RANGE_DEG,
  FIELD_M2_PER_CAPITA, FIELD_MIN_BLOCK_AREA_M2, FIELD_PARCEL_MIN_ASPECT,
  FIELD_REGION_DEPTH_MAX_M, FIELD_REGION_EFFICIENCY, FIELD_REGION_INNER_VERTICES,
  GREEN_JOIN_RATIO, LANE_SETBACK_M, RING_SETBACK_M,
} from '../../src/village/constants.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import type { Croft, Green, Lane, Lot, Site } from '../../src/village/types.js';

/**
 * GATE 8.3 REWROTE THIS FILE, because the gate deleted the objects most of
 * it was about.
 *
 * The suite up to gate 8.2 tested `buildWedges` (angular sectors between
 * green-attached lanes), `blockOuterRadius` (the census solved as an
 * annulus), `blockSlots` (a wedge cut into angular slots) and `slotCourses`
 * (a slot cut into radial courses). All four are gone, along with every
 * premise built on them -- "blocks in one wedge share a furrow bearing",
 * "adjacent wedges run their furrows 90 degrees apart", "no block is
 * outside the course depth band", "ids read field:<wedgeId>:S<i>".
 *
 * They are not loosened here, they are REPLACED, because the thing they
 * asserted is exactly the thing the owner rejected: a polar field frame.
 * What stands in their place is the property gate 8.3 exists to deliver,
 * asserted on real geometry -- that a parcel's edges are STRAIGHT and run
 * at bearings unrelated to the green.
 */

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

const bearingFrom = (c: Point, p: Point): number => (
  ((Math.atan2(p.x - c.x, -(p.y - c.y)) * 180) / Math.PI + 360) % 360
);

/**
 * THE GATE 8.3 BAR, as a function: what share of a parcel's perimeter runs
 * either RADIALLY or TANGENTIALLY about the green. An annular sector reads
 * ~1.0 by construction (its arcs are tangential and its sides radial);
 * straight edges laid at bearings unrelated to the green read ~0.22, which
 * is what 4 * 10 / 180 degrees of tolerance gives a uniform distribution.
 * Measured on gate 8.2's own output it ran 0.73-0.91.
 */
function polarShare(polys: Point[][], centre: Point): number {
  let total = 0;
  let polar = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) continue;
      const mx = (a.x + b.x) / 2 - centre.x;
      const my = (a.y + b.y) / 2 - centre.y;
      const rl = Math.hypot(mx, my);
      if (rl < 1e-9) continue;
      total += len;
      const dot = Math.abs(((b.x - a.x) * mx + (b.y - a.y) * my) / (len * rl));
      const ang = (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
      if (ang <= 10 || ang >= 80) polar += len;
    }
  }
  return total > 0 ? polar / total : NaN;
}

describe('beltPolygon (gate 8.3: the farmland\'s inner boundary is a POLYGON)', () => {
  it('has FIELD_REGION_INNER_VERTICES vertices and spends exactly that many floats', () => {
    const rngA = new SeededRandom(4);
    const poly = beltPolygon(green, circularExtent(new Point(0, 0), 60), rngA);
    expect(poly).toHaveLength(FIELD_REGION_INNER_VERTICES);
    // The draw count must not depend on the extent it is measuring.
    const rngB = new SeededRandom(4);
    beltPolygon(green, circularExtent(new Point(0, 0), 300), rngB);
    expect(rngA.float()).toBe(rngB.float());
  });

  it('lies outside the built edge by between the belt jitter bounds', () => {
    const edge = circularExtent(new Point(0, 0), 60);
    const poly = beltPolygon(green, edge, new SeededRandom(9));
    for (const p of poly) {
      const r = dist(green.centre, p);
      expect(r).toBeGreaterThanOrEqual(60 + FIELD_BELT_JITTER_MIN_M - 1e-6);
      expect(r).toBeLessThanOrEqual(60 + FIELD_BELT_JITTER_MAX_M + 1e-6);
    }
  });

  // The reason the boundary is a polygon at all: a parcel fronting the
  // village must front a STRAIGHT edge tens of metres long, not a curve
  // sampled every couple of degrees. Gate 8.2 measured its ring's inner
  // edge as "a clean round clearing" and refused its bar over it.
  it('gives the village a straight-sided clearing, not a curve', () => {
    const poly = beltPolygon(green, circularExtent(new Point(0, 0), 60), new SeededRandom(3));
    for (let i = 0; i < poly.length; i++) {
      expect(dist(poly[i], poly[(i + 1) % poly.length])).toBeGreaterThan(8);
    }
  });

  it('follows an IRREGULAR body in and out', () => {
    // An extent measured from points reaching much further north than south.
    const pts: Point[] = [];
    for (let deg = 0; deg < 360; deg += 5) {
      const r = deg < 180 ? 90 : 40;
      const rad = (deg * Math.PI) / 180;
      pts.push(new Point(Math.sin(rad) * r, -Math.cos(rad) * r));
    }
    const edge = radialExtent(new Point(0, 0), pts, 10);
    const poly = beltPolygon(green, edge, new SeededRandom(2));
    const radii = poly.map((p) => dist(green.centre, p));
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.5);
  });
});

describe('regionHull (gate 8.3: the outer boundary, and the census)', () => {
  const belt = beltPolygon(green, circularExtent(new Point(0, 0), 60), new SeededRandom(1));

  it('is convex, encloses the belt, and holds the area asked for', () => {
    const target = 60_000;
    const hull = regionHull(green, belt, target, new SeededRandom(5));
    expect(polygonArea(hull)).toBeGreaterThan(0);
    // Convex: its own hull is itself.
    expect(convexHull(hull)).toHaveLength(hull.length);
    for (const p of belt) expect(pointInPolygon(p, hull)).toBe(true);
    expect(polygonArea(hull) - polygonArea(belt)).toBeCloseTo(target, -1);
  });

  it('spends exactly 2 * FIELD_REGION_OUTER_VERTICES floats, whatever the demand', () => {
    const a = new SeededRandom(7);
    regionHull(green, belt, 10_000, a);
    const b = new SeededRandom(7);
    regionHull(green, belt, 500_000, b);
    expect(a.float()).toBe(b.float());
  });

  // The whole point of a polygon region: gate 8.2 measured the annular ring
  // delivering 52-54% of the census demand at pop 900 because
  // FIELD_BLOCK_DEPTH_MAX_M bound long before the demand was met. Here the
  // depth is SOLVED, and only a horizon caps it.
  it('grows with the demand until the depth horizon, then stops', () => {
    const small = polygonArea(regionHull(green, belt, 30_000, new SeededRandom(5)));
    const big = polygonArea(regionHull(green, belt, 200_000, new SeededRandom(5)));
    expect(big).toBeGreaterThan(small * 2);
    const huge = regionHull(green, belt, 100_000_000, new SeededRandom(5));
    for (const p of huge) {
      expect(dist(green.centre, p)).toBeLessThanOrEqual(
        60 + FIELD_BELT_JITTER_MAX_M + FIELD_REGION_DEPTH_MAX_M * 1.4 + 1e-6,
      );
    }
  });

  it('is IRREGULAR: its vertices do not sit at one radius', () => {
    const hull = regionHull(green, belt, 80_000, new SeededRandom(11));
    const radii = hull.map((p) => dist(green.centre, p));
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.25);
  });
});

describe('clipOutsideBelt (gate 8.3: taking the village out of a cell)', () => {
  const belt = beltPolygon(green, circularExtent(new Point(0, 0), 60), new SeededRandom(1));

  it('drops a cell wholly inside the village and keeps one wholly outside', () => {
    const inner = [new Point(-5, -5), new Point(5, -5), new Point(5, 5), new Point(-5, 5)];
    expect(clipOutsideBelt(inner, belt)).toEqual([]);
    const outer = [new Point(200, 200), new Point(230, 200), new Point(230, 230), new Point(200, 230)];
    expect(clipOutsideBelt(outer, belt)).toHaveLength(4);
  });

  // The first draft INTERSECTED every touching edge's outward half-plane,
  // which takes the whole corner away at a belt vertex -- eighteen scallops
  // of empty lawn round the village. The greedy one-line-at-a-time cut is
  // what keeps the fields against the houses.
  it('keeps most of a cell straddling the boundary near a belt corner', () => {
    const v = belt[0];
    const r = dist(green.centre, v);
    const ux = v.x / r;
    const uy = v.y / r;
    // A 40 m square centred on the belt vertex: half of it is village.
    const cx = v.x;
    const cy = v.y;
    const cell = [
      new Point(cx - 20 * uy - 20 * ux, cy + 20 * ux - 20 * uy),
      new Point(cx + 20 * uy - 20 * ux, cy - 20 * ux - 20 * uy),
      new Point(cx + 20 * uy + 20 * ux, cy - 20 * ux + 20 * uy),
      new Point(cx - 20 * uy + 20 * ux, cy + 20 * ux + 20 * uy),
    ];
    const kept = clipOutsideBelt(cell, belt);
    expect(polygonArea(kept)).toBeGreaterThan(0.3 * 1600);
    for (const p of kept) expect(pointInPolygon(p, belt)).toBe(false);
  });
});

describe('exitRoads', () => {
  it('takes one line per green-attached lane that reaches the farmland', () => {
    const belt = beltPolygon(green, circularExtent(new Point(0, 0), 60), new SeededRandom(1));
    const lanes = [
      lane('arm-090', 90, 150),
      lane('arm-000', 0, 30), // stops inside the village
      lane('arm-180/b10', 180, 150, { parentId: 'arm-180' }), // a branch
    ];
    const roads = exitRoads(green, lanes, belt);
    expect(roads).toHaveLength(1);
    expect(roads[0].dirDeg).toBeCloseTo(90, 6);
    expect(roads[0].halfWidthM).toBeGreaterThan(3.5 / 2);
  });

  it('does not draw a second corridor when crossing resolution has renamed the trunk that owns an apron', () => {
    // `growAprons` computes an apron's id from `rehomed.trunks`, BEFORE the
    // combined `resolveCrossings` call. If crossing resolution later splits
    // the trunk that owns an apron, the outer half -- the one carrying the
    // tip and the contract entry -- comes out renamed `T~xB`, while the
    // apron is still named from the unsplit id `T/a`. An id-strip match
    // would miss this and cut a second corridor from the same tip the
    // apron already leaves from.
    const belt = beltPolygon(green, circularExtent(new Point(0, 0), 60), new SeededRandom(1));
    const r = (90 * Math.PI) / 180;
    const dir = new Point(Math.sin(r), -Math.cos(r));
    const tip = new Point(dir.x * 150, dir.y * 150);
    const splitTrunk: Lane = {
      id: 'trunk-main-045~xtrunk-local-120', type: 'main', widthM: 5,
      points: [new Point(dir.x * 11, dir.y * 11), tip],
    };
    const apron: Lane = {
      id: 'trunk-main-045/a', type: 'main', widthM: 5,
      points: [tip.clone(), new Point(dir.x * 300, dir.y * 300)],
    };
    const roads = exitRoads(green, [splitTrunk, apron], belt);
    expect(roads).toHaveLength(1);
  });
});

describe('buildFields', () => {
  const emptyLots: Lot[] = [];
  const emptyCrofts: Croft[] = [];

  it('every parcel is a straight-edged polygon, not an annular sector', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, new SeededRandom(1));
    expect(blocks.length).toBeGreaterThan(10);
    // A sector emitted by the old frame had dozens of vertices, two per
    // slice of arc. A cut parcel has a handful.
    for (const b of blocks) {
      expect(b.polygon.length).toBeGreaterThanOrEqual(3);
      expect(b.polygon.length).toBeLessThanOrEqual(12);
    }
    // And the bar itself. Gate 8.2's ring measured 0.73-0.91 here.
    expect(polarShare(blocks.map((b) => b.polygon), green.centre)).toBeLessThan(0.5);
  });

  it('ploughs each parcel along ITS OWN long axis, within the jitter', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, new SeededRandom(6));
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const axis = longAxisDeg(b.polygon);
      const gap = angularGap(b.furrowBearingDeg, axis) % 180;
      expect(Math.min(gap, 180 - gap)).toBeLessThanOrEqual(FIELD_JITTER_RANGE_DEG / 2 + 1e-6);
    }
  });

  // The premise this replaces -- "adjacent wedges run their furrows ~90
  // degrees apart" -- existed to break the seam between two neighbouring
  // ESTATES, an object that no longer exists. A parcel is ploughed along
  // its own length, and neighbouring parcels rarely share a long axis, so
  // the seam does not form in the first place. That is what is asserted.
  it('does not run the whole village\'s furrows one way', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, new SeededRandom(6));
    const bearings = blocks.map((b) => b.furrowBearingDeg % 180);
    const buckets = new Set(bearings.map((b) => Math.floor(b / 30)));
    expect(buckets.size).toBeGreaterThanOrEqual(4);
  });

  it('emits ids as field:P<i>, unique across the village', () => {
    const lanes = [lane('arm-090', 90), lane('arm-270', 270)];
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, new SeededRandom(5));
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(/^field:P\d+$/.test(b.id)).toBe(true);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });

  it('keeps no parcel below the area floor, and no splinter', () => {
    const lanes = [lane('arm-090', 90), lane('arm-270', 270), lane('arm-000', 0)];
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, new SeededRandom(7));
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(b.areaM2).toBeGreaterThanOrEqual(FIELD_MIN_BLOCK_AREA_M2);
      expect(polygonArea(b.polygon)).toBeCloseTo(b.areaM2, 3);
      const axis = longAxisDeg(b.polygon);
      const proj = (deg: number): number => {
        const r = (deg * Math.PI) / 180;
        const nx = Math.sin(r);
        const ny = -Math.cos(r);
        const ts = b.polygon.map((p) => p.x * nx + p.y * ny);
        return Math.max(...ts) - Math.min(...ts);
      };
      expect(proj(axis + 90)).toBeGreaterThanOrEqual(
        FIELD_PARCEL_MIN_ASPECT * proj(axis) - 1e-6,
      );
    }
  });

  it('delivers the census demand it was sized for', () => {
    const lanes = [lane('arm-090', 90), lane('arm-270', 270)];
    const s = site({ population: 400 });
    const { blocks } = buildFields(s, green, lanes, emptyLots, emptyCrofts, new SeededRandom(3));
    const drawn = blocks.reduce((sum, b) => sum + b.areaM2, 0);
    const demand = s.population * FIELD_M2_PER_CAPITA;
    // The region is sized at demand / FIELD_REGION_EFFICIENCY; what comes
    // out is what the cuts, baulks and culls leave. The bar is that the
    // census is broadly honoured, which the annular ring stopped doing at
    // pop 900 (52-54%).
    expect(drawn).toBeGreaterThan(demand * 0.7);
    expect(drawn).toBeLessThan(demand / FIELD_REGION_EFFICIENCY);
  });

  it('is empty (fails soft) when the region is entirely walled off', () => {
    const bigWater = [[
      new Point(-1000, -1000), new Point(1000, -1000), new Point(1000, 1000), new Point(-1000, 1000),
    ]];
    const lanes = [lane('arm-090', 90), lane('arm-270', 270)];
    const { blocks } = buildFields(
      site({ water: bigWater }), green, lanes, emptyLots, emptyCrofts, new SeededRandom(1),
    );
    expect(blocks).toEqual([]);
  });

  it('never throws with zero lanes, zero lots, zero crofts', () => {
    expect(() => buildFields(site(), green, [], [], [], new SeededRandom(1))).not.toThrow();
  });

  it('tundra uses only its native natural grazing ground', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const { blocks } = buildFields(
      site({ biome: 'tundra' }), green, lanes, emptyLots, emptyCrofts, new SeededRandom(2),
    );
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(FIELD_CROPS.tundra).toContain(b.glyph);
  });

  it('temperate cycles its native crop and orchard table', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const { blocks } = buildFields(site(), green, lanes, emptyLots, emptyCrofts, new SeededRandom(2));
    const allowed = new Set([...FIELD_CROPS.temperate, 'sm-field-orchard', 'sm-field-vine']);
    for (const b of blocks) expect(allowed.has(b.glyph)).toBe(true);
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

  it('no field parcel point falls inside a croft, lot claim, lane corridor, green, or water', () => {
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

  // GATE 8.3's bar, through the real pipeline and at both acceptance sizes.
  // Gate 8.2's ring scored 0.73-0.91 on this and its author refused the
  // visual bar because of it.
  it('draws no polar parcels at pop 300 or pop 900', () => {
    const popInput = (population: number): AzgaarBurgInput => ({
      name: 'Polar', population, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    });
    for (const pop of [300, 900]) {
      const m = generateVillage(popInput(pop), 1);
      expect(m.fields.length).toBeGreaterThan(10);
      expect(polarShare(m.fields.map((f) => f.polygon), m.green.centre)).toBeLessThan(0.5);
    }
  }, 20000);

  it('honours the census far better than the annular ring did', () => {
    const popInput = (population: number): AzgaarBurgInput => ({
      name: 'Census', population, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    });
    // Gate 8.2 measured 92-95% at pop 300 and 52-54% at pop 900, the latter
    // because FIELD_BLOCK_DEPTH_MAX_M bound long before the demand was met.
    for (const pop of [300, 900]) {
      const m = generateVillage(popInput(pop), 1);
      const drawn = m.fields.reduce((s, f) => s + f.areaM2, 0);
      expect(drawn).toBeGreaterThan(pop * FIELD_M2_PER_CAPITA * 0.8);
    }
  }, 20000);

  it('is deterministic through the full generateVillage pipeline', () => {
    for (const input of inputs) {
      const a = generateVillage(input, 42).fields;
      const b = generateVillage(input, 42).fields;
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  }, 20000);

  it('never throws end to end, including a bare/degenerate input', () => {
    const bare: AzgaarBurgInput = {
      name: 'Bare', population: 12, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
    };
    expect(() => generateVillage(bare, 1)).not.toThrow();
    const m = generateVillage(bare, 1);
    expect(Array.isArray(m.fields)).toBe(true);
  });

  // Fix round 1 regression net (2026-08-21): a post-completion probe found
  // `fields` empty in every one of 14 fixtures. This is the guard that
  // would have caught it, and it caught gate 8.3's own first draft of the
  // belt clip, which emptied the region and drew nothing at all.
  it('produces field parcels through the real pipeline (pop 300 and pop 900)', () => {
    const popInput = (population: number): AzgaarBurgInput => ({
      name: 'Regression', population, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    });
    expect(generateVillage(popInput(300), 1).fields.length).toBeGreaterThan(10);
    expect(generateVillage(popInput(900), 1).fields.length).toBeGreaterThan(10);
  }, 20000);
});
