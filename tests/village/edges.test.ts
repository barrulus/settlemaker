import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { settlementEdgeStyle, stampEdge } from '../../src/village/dressing/edges.js';
import { nominalFootprint } from '../../src/village/glyphs.js';
import {
  EDGE_NONE_POP_THRESHOLD, EDGE_STYLE_ORDER, EDGE_STYLE_WEIGHTS,
} from '../../src/village/constants.js';
import type { Lane } from '../../src/village/types.js';

const lane = (over: Partial<Lane> = {}): Lane => ({
  id: 'arm-000', type: 'local', points: [new Point(0, -50), new Point(0, 50)], widthM: 3.5,
  ...over,
});

describe('settlementEdgeStyle', () => {
  it('only ever draws styles named in EDGE_STYLE_ORDER', () => {
    const rng = new SeededRandom(1);
    for (let i = 0; i < 500; i++) {
      const style = settlementEdgeStyle('temperate', 900, rng);
      expect(EDGE_STYLE_ORDER).toContain(style);
    }
  });

  it('draws exactly one rng value per call', () => {
    const rng = new SeededRandom(7);
    settlementEdgeStyle('temperate', 900, rng);
    const afterOne = rng.getSeed();
    const rng2 = new SeededRandom(7);
    rng2.float();
    expect(rng2.getSeed()).toBe(afterOne);
  });

  it('is deterministic for a fixed seed', () => {
    const a = settlementEdgeStyle('temperate', 900, new SeededRandom(42));
    const b = settlementEdgeStyle('temperate', 900, new SeededRandom(42));
    expect(a).toBe(b);
  });

  it('temperate never draws hedge/wall/fence/ditch above threshold with weight 0 for none', () => {
    // temperate's table has none: 0 above threshold, so at pop 900 'none'
    // should never appear (roll <= 0 can still land there only if total
    // weight sums exactly, verified via large sample).
    const rng = new SeededRandom(3);
    let sawNone = false;
    for (let i = 0; i < 2000; i++) {
      if (settlementEdgeStyle('temperate', 900, rng) === 'none') sawNone = true;
    }
    expect(sawNone).toBe(false);
  });

  it('desert and tundra never draw hedge', () => {
    const rng = new SeededRandom(5);
    for (let i = 0; i < 500; i++) {
      expect(settlementEdgeStyle('desert', 900, rng)).not.toBe('hedge');
      expect(settlementEdgeStyle('tundra', 900, rng)).not.toBe('hedge');
    }
  });

  it('unlisted biomes (tropical/coastal) fall back to the temperate table', () => {
    const rng1 = new SeededRandom(11);
    const rng2 = new SeededRandom(11);
    const tropical = settlementEdgeStyle('tropical', 900, rng1);
    const temperate = settlementEdgeStyle('temperate', 900, rng2);
    expect(tropical).toBe(temperate);
  });

  it('poor/small sites (below the population threshold) draw none more often', () => {
    const below = new SeededRandom(9);
    const above = new SeededRandom(9);
    let noneBelow = 0;
    let noneAbove = 0;
    const trials = 3000;
    for (let i = 0; i < trials; i++) {
      if (settlementEdgeStyle('temperate', EDGE_NONE_POP_THRESHOLD - 1, below) === 'none') noneBelow++;
      if (settlementEdgeStyle('temperate', EDGE_NONE_POP_THRESHOLD, above) === 'none') noneAbove++;
    }
    expect(noneBelow).toBeGreaterThan(noneAbove);
    expect(noneBelow / trials).toBeGreaterThan(0.15);
  });

  it('weights table renormalises: distribution roughly matches configured proportions', () => {
    const rng = new SeededRandom(21);
    const counts: Record<string, number> = { hedge: 0, wall: 0, fence: 0, ditch: 0, none: 0 };
    const trials = 20000;
    for (let i = 0; i < trials; i++) {
      counts[settlementEdgeStyle('temperate', 900, rng)]++;
    }
    const weights = EDGE_STYLE_WEIGHTS.temperate;
    for (const style of EDGE_STYLE_ORDER) {
      expect(counts[style] / trials).toBeCloseTo(weights[style], 1);
    }
  });
});

describe('stampEdge', () => {
  const straight = [new Point(0, 0), new Point(100, 0)];

  it('returns [] for style "none"', () => {
    expect(stampEdge('owner', straight, 'none', [])).toEqual([]);
  });

  it('returns [] for a degenerate polyline', () => {
    expect(stampEdge('owner', [new Point(0, 0)], 'hedge', [])).toEqual([]);
    expect(stampEdge('owner', [], 'hedge', [])).toEqual([]);
  });

  it('stamps one per footprint length, centred, with fixed id/glyph/bearing', () => {
    const stamps = stampEdge('owner', straight, 'hedge', []);
    const step = nominalFootprint('sm-edge-hedge')[0];
    expect(step).toBe(8);
    // 100m / 8m -> centres at 4, 12, 20, ..., 92 -> 12 stamps
    const expectedCount = Math.ceil((100 - step / 2) / step);
    expect(stamps).toHaveLength(expectedCount);
    stamps.forEach((s, idx) => {
      expect(s.id).toBe(`edge:owner:${idx}`);
      expect(s.glyph).toBe('sm-edge-hedge');
      expect(s.bearingDeg).toBeCloseTo(90); // +x direction = east = 90deg
    });
    expect(stamps[0].position.x).toBeCloseTo(4);
    expect(stamps[1].position.x).toBeCloseTo(12);
  });

  it('uses the correct glyph per style', () => {
    expect(stampEdge('o', straight, 'wall', [])[0].glyph).toBe('sm-edge-wall');
    expect(stampEdge('o', straight, 'fence', [])[0].glyph).toBe('sm-edge-fence');
    expect(stampEdge('o', straight, 'ditch', [])[0].glyph).toBe('sm-edge-ditch');
  });

  it('skips a stamp whose centre falls within a lane corridor', () => {
    const noLanes = stampEdge('owner', straight, 'hedge', []);
    const crossingLane = lane({ points: [new Point(50, -20), new Point(50, 20)], widthM: 3.5 });
    const withLane = stampEdge('owner', straight, 'hedge', [crossingLane]);
    expect(withLane.length).toBeLessThan(noLanes.length);
    // The stamp nearest x=50 (centred at 52) should be gone.
    expect(withLane.some((s) => Math.abs(s.position.x - 52) < 0.01)).toBe(false);
    // Ids of surviving stamps should skip the missing ordinal, not compact.
    const ids = withLane.map((s) => s.id);
    expect(ids).not.toContain('edge:owner:6');
  });

  it('breaking at a lane corridor splits the edge rather than only trimming an end', () => {
    const crossingLane = lane({ points: [new Point(50, -20), new Point(50, 20)], widthM: 3.5 });
    const stamps = stampEdge('owner', straight, 'hedge', [crossingLane]);
    const beforeGap = stamps.some((s) => s.position.x < 45);
    const afterGap = stamps.some((s) => s.position.x > 55);
    expect(beforeGap).toBe(true);
    expect(afterGap).toBe(true);
  });

  it('draws no rng (deterministic across repeated calls, no seed involved)', () => {
    const a = stampEdge('owner', straight, 'hedge', []);
    const b = stampEdge('owner', straight, 'hedge', []);
    expect(a).toEqual(b);
  });

  it('a lane with fewer than 2 points is ignored, not thrown on', () => {
    const degenerateLane = lane({ points: [new Point(50, 0)] });
    expect(() => stampEdge('owner', straight, 'hedge', [degenerateLane])).not.toThrow();
  });
});
