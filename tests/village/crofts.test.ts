import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { buildCrofts, croftDepthTarget } from '../../src/village/dressing/crofts.js';
import { lotObb, obbOverlap } from '../../src/village/parcels/overlap.js';
import { generateVillage } from '../../src/village/village-model.js';
import { CROFT_DEPTH_MAX_M, CROFT_MIN_DEPTH_M } from '../../src/village/constants.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import type {
  Building, Green, Lane, Lot,
} from '../../src/village/types.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

// bearingDeg 90 -> facing east (+x), so `front` is the lot's frontage
// midpoint and its claim/croft extend WEST (away from the lane at +x).
const lot = (id: string, x: number, y: number, over: Partial<Lot> = {}): Lot => ({
  id, laneId: 'arm-090', side: 1, front: new Point(x, y), bearingDeg: 90,
  frontageM: 6, depthM: 16, score: 0, ...over,
});

const building = (lotIdValue: string): Building => ({
  id: `bld:${lotIdValue}`, lotId: lotIdValue, glyph: 'sm-house', position: new Point(0, 0),
  bearingDeg: 0, footprint: [5, 4], occupancy: 4,
});

describe('croftDepthTarget', () => {
  it('is 0 for a lot near the green (tight frontage)', () => {
    const near = lot('a', 10, 0);
    expect(croftDepthTarget(near, green, 100, 5)).toBe(0);
  });

  it('is > 0, up to CROFT_DEPTH_MAX_M, for a lot at the fringe', () => {
    const far = lot('b', 150, 0);
    const depth = croftDepthTarget(far, green, 100, 5);
    expect(depth).toBeGreaterThan(0);
    expect(depth).toBeLessThanOrEqual(CROFT_DEPTH_MAX_M);
  });

  it('is 0 when f0 is 0 (degenerate, never divides by zero)', () => {
    expect(croftDepthTarget(lot('c', 150, 0), green, 100, 0)).toBe(0);
  });
});

describe('buildCrofts', () => {
  it('gives a built, far-from-green lot a nonzero-depth croft with the right id', () => {
    const far = lot('arm-090:R0', 150, 0);
    const crofts = buildCrofts([far], [building('arm-090:R0')], green, [], [], 100, 5, 'hedge');
    expect(crofts).toHaveLength(1);
    expect(crofts[0].id).toBe('croft:arm-090:R0');
    expect(crofts[0].lotId).toBe('arm-090:R0');
    expect(crofts[0].depthM).toBeGreaterThan(0);
    expect(crofts[0].polygon).toHaveLength(4);
  });

  it('gives an empty lot (no building) no croft', () => {
    const far = lot('arm-090:R0', 150, 0);
    const crofts = buildCrofts([far], [], green, [], [], 100, 5, 'hedge');
    expect(crofts).toHaveLength(0);
  });

  it('gives a built, tight (near-green) lot no croft', () => {
    const near = lot('arm-090:R0', 10, 0);
    const crofts = buildCrofts([near], [building('arm-090:R0')], green, [], [], 100, 5, 'hedge');
    expect(crofts).toHaveLength(0);
  });

  it('emits no boundary stamps for style "none"', () => {
    const far = lot('arm-090:R0', 150, 0);
    const crofts = buildCrofts([far], [building('arm-090:R0')], green, [], [], 100, 5, 'none');
    expect(crofts).toHaveLength(1);
    expect(crofts[0].boundary).toEqual([]);
  });

  it('truncates a croft rather than letting it cross a lane corridor', () => {
    const far = lot('arm-090:R0', 150, 0);
    // A lane running north-south right behind where the croft would
    // otherwise reach (unclipped depth would run to x=150-16-25=109).
    const blocker: Lane = {
      id: 'arm-180', type: 'local', points: [new Point(120, -50), new Point(120, 50)], widthM: 3.5,
    };
    const crofts = buildCrofts(
      [far], [building('arm-090:R0')], green, [blocker], [], 100, 5, 'hedge',
    );
    expect(crofts).toHaveLength(1);
    // The croft's near-west corners must not cross into the lane's corridor.
    const clearance = blocker.widthM / 2 + 1; // LANE_SETBACK_M.local = 1
    for (const p of crofts[0].polygon) {
      expect(p.x).toBeGreaterThanOrEqual(120 - clearance - 1e-6);
    }
  });

  it('truncates a croft against another lot claim rather than overlapping it', () => {
    const a = lot('arm-090:R0', 150, 0, { frontageM: 6, depthM: 16 });
    // A perpendicular lot whose claim sits right behind `a`'s croft path.
    const blockerLot: Lot = {
      id: 'arm-000:R0', laneId: 'arm-000', side: 1, front: new Point(115, 0),
      bearingDeg: 0, frontageM: 30, depthM: 16, score: 0,
    };
    const crofts = buildCrofts(
      [a, blockerLot], [building('arm-090:R0')], green, [], [], 100, 5, 'hedge',
    );
    expect(crofts).toHaveLength(1);
    const croftObbLike = {
      center: new Point(
        (crofts[0].polygon[0].x + crofts[0].polygon[2].x) / 2,
        (crofts[0].polygon[0].y + crofts[0].polygon[2].y) / 2,
      ),
      tangent: new Point(0, 1), normal: new Point(-1, 0),
      halfW: a.frontageM / 2, halfD: crofts[0].depthM / 2,
    };
    expect(obbOverlap(croftObbLike, lotObb(blockerLot))).toBe(false);
  });

  it('truncates a croft rather than letting it overlap an already-placed croft', () => {
    // Two parallel lots on the same lane, close enough along the frontage
    // axis that unclipped 25m-deep crofts (side by side, same depth axis)
    // would overlap if the truncation against neighbouring claims failed --
    // here we force it via two lots facing the SAME direction, offset only
    // slightly in the tangent axis, both far from the green.
    const a = lot('arm-090:R0', 150, 0, { frontageM: 6 });
    const b = lot('arm-090:R1', 150, 5, { frontageM: 6 });
    const crofts = buildCrofts(
      [a, b], [building('arm-090:R0'), building('arm-090:R1')], green, [], [], 100, 5, 'hedge',
    );
    // Both are built and far; at least the deterministic fill order should
    // yield two disjoint crofts (or one truncated to clear the other).
    if (crofts.length === 2) {
      const obbFrom = (poly: Point[], depth: number) => ({
        center: new Point((poly[0].x + poly[2].x) / 2, (poly[0].y + poly[2].y) / 2),
        tangent: new Point(0, 1), normal: new Point(-1, 0), halfW: 3, halfD: depth / 2,
      });
      expect(obbOverlap(
        obbFrom(crofts[0].polygon, crofts[0].depthM),
        obbFrom(crofts[1].polygon, crofts[1].depthM),
      )).toBe(false);
    }
  });

  it('never crosses below CROFT_MIN_DEPTH_M -- truncation that tight drops the croft', () => {
    const far = lot('arm-090:R0', 150, 0);
    // A lane immediately behind the lot's claim, leaving no room at all.
    const blocker: Lane = {
      id: 'arm-180', type: 'local', points: [new Point(133, -50), new Point(133, 50)], widthM: 3.5,
    };
    const crofts = buildCrofts(
      [far], [building('arm-090:R0')], green, [blocker], [], 100, 5, 'hedge',
    );
    expect(crofts).toHaveLength(0);
  });

  it('is deterministic: identical inputs produce identical output', () => {
    const far = lot('arm-090:R0', 150, 0);
    const a = buildCrofts([far], [building('arm-090:R0')], green, [], [], 100, 5, 'hedge');
    const b = buildCrofts([far], [building('arm-090:R0')], green, [], [], 100, 5, 'hedge');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('crofts in a full village (pop 900)', () => {
  const base: AzgaarBurgInput = {
    name: 'Wick', population: 900, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false,
    roadBearings: [{ bearing_deg: 225, kind: 'road' }],
  };

  it('has some near-green built lots with no croft and some fringe lots with one', () => {
    const m = generateVillage(base, 1);
    const builtLotById = new Map(m.buildings.map((b) => [b.lotId, b]));
    const croftLotIds = new Set(m.crofts.map((c) => c.lotId));

    const distToGreen = (l: Lot) => Math.hypot(l.front.x - m.green.centre.x, l.front.y - m.green.centre.y);
    const builtLots = m.lots.filter((l) => builtLotById.has(l.id));
    const sorted = [...builtLots].sort((a, b) => distToGreen(a) - distToGreen(b));

    expect(sorted.length).toBeGreaterThan(4);
    // Nearest-to-green built lots: at least one has no croft.
    const nearest = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.2)));
    expect(nearest.some((l) => !croftLotIds.has(l.id))).toBe(true);
    // Farthest-from-green built lots: at least one has a nonzero croft.
    const farthest = sorted.slice(-Math.max(1, Math.floor(sorted.length * 0.2)));
    expect(farthest.some((l) => croftLotIds.has(l.id))).toBe(true);
  });

  it('every croft has depth >= CROFT_MIN_DEPTH_M and <= CROFT_DEPTH_MAX_M', () => {
    const m = generateVillage(base, 1);
    for (const croft of m.crofts) {
      expect(croft.depthM).toBeGreaterThanOrEqual(CROFT_MIN_DEPTH_M);
      expect(croft.depthM).toBeLessThanOrEqual(CROFT_DEPTH_MAX_M);
    }
  });

  it('croft ids all follow croft:<lotId>', () => {
    const m = generateVillage(base, 1);
    for (const croft of m.crofts) {
      expect(croft.id).toBe(`croft:${croft.lotId}`);
    }
  });

  it('no croft overlaps another croft (sampled OBB check)', () => {
    const m = generateVillage(base, 1);
    const obbFrom = (c: (typeof m.crofts)[number]) => {
      const [near1, near2, far2, far1] = c.polygon;
      const center = new Point(
        (near1.x + near2.x + far1.x + far2.x) / 4,
        (near1.y + near2.y + far1.y + far2.y) / 4,
      );
      const tangent = new Point(near2.x - near1.x, near2.y - near1.y);
      const tLen = Math.hypot(tangent.x, tangent.y) || 1;
      tangent.x /= tLen; tangent.y /= tLen;
      const normal = new Point(-tangent.y, tangent.x);
      return {
        center, tangent, normal, halfW: tLen / 2, halfD: c.depthM / 2,
      };
    };
    for (let i = 0; i < m.crofts.length; i++) {
      for (let j = i + 1; j < m.crofts.length; j++) {
        expect(obbOverlap(obbFrom(m.crofts[i]), obbFrom(m.crofts[j]), 1e-6)).toBe(false);
      }
    }
  });

  it('is deterministic: same seed produces identical crofts + edgeStyle', () => {
    const a = generateVillage(base, 5);
    const b = generateVillage(base, 5);
    expect(a.edgeStyle).toBe(b.edgeStyle);
    expect(JSON.stringify(a.crofts)).toBe(JSON.stringify(b.crofts));
  });
});
