import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { pointInPolygon } from '../../src/geom/point-in-polygon.js';
import { SeededRandom } from '../../src/utils/random.js';
import { buildVegetation } from '../../src/village/dressing/vegetation.js';
import { circularExtent } from '../../src/village/dressing/extent.js';
import { generateVillage } from '../../src/village/village-model.js';
import { hasGlyph } from '../../src/village/glyphs.js';
import { lotObb, obbOverlap } from '../../src/village/parcels/overlap.js';
import { closestPointOnSegment, dist } from '../../src/village/geometry.js';
import {
  CLUMP_RADIUS_M, GREEN_JOIN_RATIO, RING_SETBACK_M, SHOREFRONT_BAND_M,
  SHOREFRONT_REACH_FACTOR, VEG_BAND_DEPTH_M, VEG_GLYPHS, VEG_LANE_CLEAR_M,
  VEG_SCALE_MAX, VEG_SCALE_MIN,
} from '../../src/village/constants.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import type {
  Croft, FieldBlock, Green, Lane, Lot, Site,
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

// GATE 8: the two edges vegetation works between are per-bearing extents
// now, because the village body is irregular and a fixed band beyond a
// single radius is a circle. These tests are about the SCATTER, not the
// shape, so they hand it the extent that IS the radius they used to pass.
const circ = (radiusM: number) => circularExtent(green.centre, radiusM);

const emptyLots: Lot[] = [];
const emptyCrofts: Croft[] = [];
const emptyFields: FieldBlock[] = [];

describe('buildVegetation', () => {
  it('is deterministic: same inputs and seed produce identical output', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const a = buildVegetation(
      site(), green, lanes, emptyLots, emptyCrofts, emptyFields, circ(40), circ(40), 60, new SeededRandom(77),
    );
    const b = buildVegetation(
      site(), green, lanes, emptyLots, emptyCrofts, emptyFields, circ(40), circ(40), 60, new SeededRandom(77),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('never throws with zero lanes, zero lots, zero crofts, zero fields', () => {
    const rng = new SeededRandom(1);
    expect(() => buildVegetation(
      site(), green, [], [], [], [], circ(40), circ(40), 60, rng,
    )).not.toThrow();
  });

  it('produces some trees for a plausible built radius', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const trees = buildVegetation(
      site(), green, lanes, emptyLots, emptyCrofts, emptyFields, circ(40), circ(40), 60, new SeededRandom(5),
    );
    expect(trees.length).toBeGreaterThan(0);
  });

  it('emits ids as veg:<cellX>x<cellY> / veg:...:<j> for groves, wood:<cellX>x<cellY>:<j> for woods', () => {
    const lanes = [lane('arm-090', 90), lane('arm-000', 0), lane('arm-200', 200)];
    const trees = buildVegetation(
      site(), green, lanes, emptyLots, emptyCrofts, emptyFields, circ(40), circ(40), 60, new SeededRandom(5),
    );
    expect(trees.length).toBeGreaterThan(0);
    const parentIds = new Set<string>();
    for (const t of trees) {
      // Gate 5.3: two id spaces now. `veg:` is a grove tree inside the
      // fabric (a cell's own tree, or its clump child); `wood:` is a tree
      // of a woodland patch outside it, which has no single parent tree --
      // the whole mass is seeded at once.
      expect(/^(veg:-?\d+x-?\d+(:\d+)?|wood:-?\d+x-?\d+:\d+)$/.test(t.id)).toBe(true);
      if (t.id.startsWith('veg:') && !t.id.includes(':', 4)) parentIds.add(t.id);
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
        site(), green, lanes, emptyLots, emptyCrofts, emptyFields, circ(40), circ(40), 60, new SeededRandom(seed),
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
      site(), green, lanes, emptyLots, emptyCrofts, emptyFields, circ(40), circ(40), 60, new SeededRandom(9),
    );
    expect(trees.length).toBeGreaterThan(0);
    for (const t of trees) {
      expect(t.scale).toBeGreaterThanOrEqual(VEG_SCALE_MIN);
      expect(t.scale).toBeLessThanOrEqual(VEG_SCALE_MAX);
    }
  });

  it('density falls with distance from the fabric edge (binned counts, generous tolerance)', () => {
    // Zone 3 (the outer scatter) is what this measures, so the grove edge
    // sits at the same radius as the field edge: no belt, straight from
    // fabric to scatter, rim == innerEdge + VEG_BAND_DEPTH_M. Out there the
    // profile thins linearly to nothing at the rim, so the half of the band
    // nearer the fabric must carry noticeably more trees than the outer
    // half.
    const groveEdge = 60;
    const innerEdge = 60;
    const rim = innerEdge + VEG_BAND_DEPTH_M;
    const mid = (innerEdge + rim) / 2;
    let near = 0;
    let far = 0;
    for (const seed of [1, 2, 3, 55, 91, 104]) {
      const trees = buildVegetation(
        site(), green, [], emptyLots, emptyCrofts, emptyFields, circ(groveEdge), circ(innerEdge), innerEdge, new SeededRandom(seed),
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

  const pointInAnyField = (p: Point, fields: FieldBlock[]): boolean => fields.some(
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

  it('no tree falls on occupied ground, a lane corridor, croft, field strip, the green, or water', () => {
    for (const input of inputs) {
      for (const seed of [1, 2, 3]) {
        const m = generateVillage(input, seed);
        const greenRadius = (m.green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
        for (const tree of m.vegetation) {
          const p = tree.position;
          expect(pointInAnyCroft(p, m.crofts)).toBe(false);
          expect(pointInAnyField(p, m.fields)).toBe(false);
          expect(pointInAnyLotClaim(p, m.lots.filter(l => m.buildings.some(b => b.lotId === l.id)))).toBe(false);
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

  // Gate 5.3 regression net: outside the fabric the scatter used to be a
  // sparse uniform dice roll, which renders as lonely specks; the reference
  // village has woodland MASSES between and behind the fields. Clustering
  // is the property, so this measures it directly -- a tree in a wood has
  // close company, a speck does not -- and also insists the woods do not
  // merge into one continuous belt.
  it('places outer trees as woodland masses, not lonely specks', () => {
    const popInput = (population: number): AzgaarBurgInput => ({
      name: 'Woods', population, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    });
    for (const population of [300, 900]) {
      const m = generateVillage(popInput(population), 1);
      const outer = m.vegetation.filter((t) => t.id.startsWith('wood:'));
      expect(outer.length).toBeGreaterThan(20);

      // Every outer tree belongs to a named patch, and patches are real
      // groups rather than one tree each.
      const patches = new Map<string, number>();
      for (const t of outer) {
        const key = t.id.slice(0, t.id.lastIndexOf(':'));
        patches.set(key, (patches.get(key) ?? 0) + 1);
      }
      expect(patches.size).toBeGreaterThan(1);
      const sizes = [...patches.values()];
      expect(Math.max(...sizes)).toBeGreaterThanOrEqual(5);

      // Clustered: the clear majority of outer trees have a neighbour
      // within a canopy's width. A uniform scatter over this area does not.
      const withCompany = outer.filter(
        (t) => outer.some((o) => o.id !== t.id && dist(t.position, o.position) <= 8),
      ).length;
      expect(withCompany / outer.length).toBeGreaterThan(0.75);

      // ...but the woods keep gaps between them: not every patch centre is
      // within one patch radius of another patch's trees.
      expect(patches.size).toBeGreaterThan(2);
    }
  }, 20000);

  // Gate 5 regression net (2026-08-22): the emphasis is FLIPPED. The owner's
  // reference has groves crowding the leftover ground between the lanes
  // INSIDE the village and only specks out in the country; the previous
  // profile did the reverse and rendered as a sparse village inside a
  // forest fringe. Density is compared per unit of area, not by raw count,
  // because the outer band is the larger region -- on the pre-flip
  // constants this ratio is well below 1.
  it('scatters far denser INSIDE the fabric than outside it (grove country)', () => {
    const popInput = (population: number): AzgaarBurgInput => ({
      name: 'Groves', population, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    });
    for (const population of [300, 900]) {
      const m = generateVillage(popInput(population), 1);
      // The fields' own outer edge is the boundary the profile switches at.
      let edge = 0;
      for (const b of m.fields) {
        for (const p of b.polygon) edge = Math.max(edge, dist(p, m.green.centre));
      }
      expect(edge).toBeGreaterThan(0);
      const rim = edge + VEG_BAND_DEPTH_M;
      // Gate 6.6: "inside" is GROVE COUNTRY -- the built fabric -- not
      // everything within the fields' outer edge. The generator's own
      // grove pass stops at the fabric radius and thins beyond it, so
      // counting the whole field ring as "inside" measured the wrong
      // region: it silently mixed the thinned belt between the houses and
      // the fields into the grove figure. That went unnoticed while the
      // fabric was 1.4x too wide (gate 6.6's finding) and filled most of
      // the field disc; with the disc sized from the census the belt is a
      // real fraction of the area and the artefact dominated the ratio.
      // The p95 building radius is the fabric edge every other acceptance
      // metric in this suite uses.
      const bd = m.buildings.map((b) => dist(b.position, m.green.centre)).sort((a, c) => a - c);
      const fabricEdge = bd[Math.floor(bd.length * 0.95)];
      let inside = 0;
      let outside = 0;
      for (const t of m.vegetation) {
        const d = dist(t.position, m.green.centre);
        if (d < fabricEdge) inside += 1;
        else if (d > edge && d <= rim) outside += 1;
      }
      // Gate 6.2: the interior denominator is the OPEN ground, not the
      // whole disc. "Grove country" means the trees fill the gaps BETWEEN
      // the houses, so measuring against total interior area punishes
      // exactly the densification concentric saturation just achieved --
      // pack the interior with houses and the per-area tree density falls
      // however well the groves do their job. Sampled rather than derived,
      // since the open area is whatever the claims leave.
      const OPEN_M = 10;
      const STEP = 4;
      let openCells = 0;
      for (let x = -fabricEdge; x <= fabricEdge; x += STEP) {
        for (let y = -fabricEdge; y <= fabricEdge; y += STEP) {
          const p = new Point(m.green.centre.x + x, m.green.centre.y + y);
          if (dist(p, m.green.centre) > fabricEdge) continue;
          if (m.buildings.some((b) => dist(p, b.position) <= OPEN_M)) continue;
          openCells += 1;
        }
      }
      const insideArea = Math.max(1, openCells) * STEP * STEP;
      const outsideArea = Math.PI * (rim * rim - edge * edge);
      expect(inside).toBeGreaterThan(0);
      // Gate 5.4 deliberately thickened the OUTER woods (bigger patches,
      // more of them, so adjacent woods merge into masses), which narrowed
      // this ratio from comfortably over 3x to about 2.95x. The property
      // being pinned is the FLIP -- grove country inside, open country
      // outside -- not the particular multiple, so the bar moved to 2x.
      //
      // It did NOT move again: at a seed chance of 0.8 the ratio fell to
      // 1.93x and this failed, and the answer was to pull the seeding back
      // to 0.7 (the brief asked for merging to be "occasional"), not to
      // lower the bar a second time until the design fit it. Gate 6.2 kept
      // the 2x bar for the same reason and fixed the DENOMINATOR instead.
      expect(inside / insideArea).toBeGreaterThan(2 * (outside / outsideArea));
    }
  }, 20000);

  // Fix wave regression net (2026-08-21, I1a): the previous net asserted
  // only ABSENCE -- no tree on a claim -- which an empty scatter satisfies
  // trivially and a dead density ramp satisfied for real. The C2 defect was
  // that `rim = builtRadius x VEG_RADIUS_FACTOR` (the retired constant)
  // always fell BELOW the field
  // band's outer edge, so densityAt collapsed to flat infill and NOT ONE
  // tree could land beyond the fields; the grid did not even reach that far.
  // This is the positive guard: real villages must put trees out past their
  // own fields. On the pre-fix code the count here is exactly 0.
  it('scatters trees beyond the fields, through the real pipeline (pop 300 and 900)', () => {
    const popInput = (population: number): AzgaarBurgInput => ({
      name: 'Beyond', population, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 225, kind: 'road' }],
    });
    for (const population of [300, 900]) {
      for (const seed of [1, 2]) {
        const m = generateVillage(popInput(population), seed);
        expect(m.fields.length).toBeGreaterThan(0);
        // The field system's own outer edge, measured off what it actually
        // laid down rather than off any radius the engine predicted.
        let fieldsOuter = 0;
        for (const strip of m.fields) {
          for (const p of strip.polygon) fieldsOuter = Math.max(fieldsOuter, dist(p, m.green.centre));
        }
        const beyond = m.vegetation.filter((t) => dist(t.position, m.green.centre) > fieldsOuter);
        expect(beyond.length).toBeGreaterThanOrEqual(5);
      }
    }
  }, 20000);

});

describe('shorefront suppression (§8.4, coastal fixture)', () => {
  // Water starts 15 m east of the green -- close enough that the ordinary
  // scatter band overlaps it, so this fixture actually exercises the rule
  // rather than the water sitting harmlessly outside the scatter band.
  const water = [[
    { x: 15, y: -200 }, { x: 200, y: -200 }, { x: 200, y: 200 }, { x: 15, y: 200 },
  ].map((p) => new Point(p.x, p.y))];
  const coastalSite = site({ water, biome: 'coastal' });
  const builtRadiusM = 30;
  const reach = builtRadiusM * SHOREFRONT_REACH_FACTOR;
  // The scatter's own inner edge is independent of the shorefront reach
  // (fix wave, C2: they are two separate MEASURED radii now), and must be
  // large enough that the rim -- innerEdgeM + VEG_BAND_DEPTH_M -- reaches
  // past `reach`, or "beyond the reach, scatter resumes" has no band to
  // resume in.
  const innerEdgeM = 60;
  // Grove country stops well short of the field edge in this fixture, so
  // the shorefront band is exercised against the low outer density.
  const groveEdgeM = 30;

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
        coastalSite, green, [], emptyLots, emptyCrofts, emptyFields, circ(groveEdgeM), circ(innerEdgeM), reach, new SeededRandom(seed),
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
        coastalSite, green, [], emptyLots, emptyCrofts, emptyFields, circ(groveEdgeM), circ(innerEdgeM), reach, new SeededRandom(seed),
      );
      for (const tree of trees) {
        const d = dist(tree.position, green.centre);
        if (d > reach && nearestWaterEdge(tree.position) <= SHOREFRONT_BAND_M) allowedNearWater += 1;
      }
    }
    expect(allowedNearWater).toBeGreaterThan(0);
  });
});
