import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { subdivideGreen } from '../../src/village/parcels/lots.js';
import type { Green } from '../../src/village/types.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 30, bearingDeg: 0,
};

describe('subdivideGreen', () => {
  it('rings the green with lots at the tightest frontage in the settlement', () => {
    const lots = subdivideGreen(green, 10, 22, new SeededRandom(1));
    expect(lots.length).toBeGreaterThan(3);
    for (const l of lots) expect(l.frontageM).toBeCloseTo(10, 0);
  });

  it('faces every ring lot inward at the green', () => {
    const lots = subdivideGreen(green, 10, 22, new SeededRandom(1));
    for (const l of lots) {
      // Bearing points from the lot back toward the centre.
      const toCentre = (Math.atan2(-l.front.x, l.front.y) * 180) / Math.PI;
      const want = (toCentre + 360) % 360;
      const diff = Math.abs(((l.bearingDeg - want + 540) % 360) - 180);
      expect(diff).toBeLessThan(15);
    }
  });

  it('places lots on the rim plus a setback, not inside the green', () => {
    const lots = subdivideGreen(green, 10, 22, new SeededRandom(1));
    for (const l of lots) {
      expect(Math.hypot(l.front.x, l.front.y)).toBeGreaterThan(green.diameter / 2);
    }
  });

  it('gives ring lots their own stable ids', () => {
    const lots = subdivideGreen(green, 10, 22, new SeededRandom(1));
    expect(lots[0].id).toBe('green:R0');
    expect(lots[1].id).toBe('green:R1');
    expect(new Set(lots.map((l) => l.id)).size).toBe(lots.length);
  });

  it('is deterministic for a seed', () => {
    const mk = () => subdivideGreen(green, 10, 22, new SeededRandom(9));
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});
