// tests/village/trunks-curves.test.ts
import { describe, expect, it } from 'vitest';
import { drawTrunkPath } from '../../src/village/skeleton/trunks.js';
import { TRUNK_SAGITTA_RATIO } from '../../src/village/constants.js';
import type { RouteType } from '../../src/village/route-class.js';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';

/** Max perpendicular distance of any sample from the from-to chord segment. */
function maxChordDeviation(points: Point[]): number {
  const from = points[0];
  const to = points[points.length - 1];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chordLen = Math.hypot(dx, dy);
  if (chordLen === 0) return 0;
  let max = 0;
  for (const p of points) {
    // perpendicular distance from point to the infinite line through from/to
    const cross = (p.x - from.x) * dy - (p.y - from.y) * dx;
    const dist = Math.abs(cross) / chordLen;
    if (dist > max) max = dist;
  }
  return max;
}

describe('drawTrunkPath', () => {
  const from = new Point(0, 0);
  const to = new Point(200, 0);

  it('(a) endpoints are exact: from first, to last', () => {
    const pts = drawTrunkPath(from, to, 'local', new SeededRandom(3));
    expect(pts[0].x).toBeCloseTo(from.x, 9);
    expect(pts[0].y).toBeCloseTo(from.y, 9);
    expect(pts[pts.length - 1].x).toBeCloseTo(to.x, 9);
    expect(pts[pts.length - 1].y).toBeCloseTo(to.y, 9);
  });

  it('(b) class stiffness orders deviation: royal < local < footpath (statistical, seeds 1..20)', () => {
    const meanDev = (t: RouteType) => {
      let total = 0;
      const n = 20;
      for (let seed = 1; seed <= n; seed++) {
        total += maxChordDeviation(drawTrunkPath(from, to, t, new SeededRandom(seed)));
      }
      return total / n;
    };
    const royal = meanDev('royal');
    const local = meanDev('local');
    const footpath = meanDev('footpath');
    expect(royal).toBeLessThan(local);
    expect(local).toBeLessThan(footpath);
  });

  it('(c) royal deviation stays within its sagitta bound', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const dev = maxChordDeviation(drawTrunkPath(from, to, 'royal', new SeededRandom(seed)));
      const chordLength = Point.distance(from, to);
      expect(dev).toBeLessThanOrEqual(TRUNK_SAGITTA_RATIO.royal * chordLength * 1.05);
    }
  });

  it('(d) determinism: same seed twice -> deeply equal points; different seed -> different interior points, same endpoints', () => {
    const a = drawTrunkPath(from, to, 'local', new SeededRandom(11));
    const b = drawTrunkPath(from, to, 'local', new SeededRandom(11));
    expect(a).toEqual(b);

    const c = drawTrunkPath(from, to, 'local', new SeededRandom(12));
    expect(c[0]).toEqual(a[0]);
    expect(c[c.length - 1]).toEqual(a[a.length - 1]);
    // at least one interior point should differ
    const interiorDiffers = a.some((p, i) => {
      const q = c[i];
      return !q || p.x !== q.x || p.y !== q.y;
    }) || a.length !== c.length;
    expect(interiorDiffers).toBe(true);
  });

  it('(e) sample spacing stays <= 8 m everywhere', () => {
    for (const t of ['royal', 'main', 'market', 'town', 'local', 'trail', 'footpath'] as RouteType[]) {
      const pts = drawTrunkPath(from, to, t, new SeededRandom(5));
      for (let i = 1; i < pts.length; i++) {
        const d = Point.distance(pts[i - 1], pts[i]);
        expect(d).toBeLessThanOrEqual(8);
      }
    }
  });
});
