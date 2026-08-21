import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { GREEN_JOIN_RATIO, RING_SETBACK_M } from '../../src/village/constants.js';
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
      expect(diff).toBeLessThan(2);
    }
  });

  it('places lots right at the DRAWN edge — green frontage means at the green', () => {
    // Gate 2: the ring's fronts sit on the drawn turf edge (the art fills
    // ~87% of its box) plus a sliver — not metres of empty grass out.
    const lots = subdivideGreen(green, 10, 22, new SeededRandom(1));
    const expected = (green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
    for (const l of lots) {
      expect(Math.hypot(l.front.x, l.front.y)).toBeCloseTo(expected, 5);
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

  describe('with a green off the origin', () => {
    // A green anywhere but (0,0) — a coastal green pinned to a shoreline,
    // say — is the case a naive implementation gets wrong by placing the
    // ring around the world origin instead of the green's own centre.
    const offCentre = new Point(50, -30);
    const offGreen: Green = { ...green, centre: offCentre };

    it('sits at radius from the green\'s own centre, not the origin', () => {
      const lots = subdivideGreen(offGreen, 10, 22, new SeededRandom(1));
      // Gate 2: the ring sits at the DRAWN edge plus the sliver setback.
      const radius = (offGreen.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
      for (const l of lots) {
        const d = Math.hypot(l.front.x - offCentre.x, l.front.y - offCentre.y);
        expect(d).toBeCloseTo(radius, 1);
      }
    });

    it('faces every ring lot inward at the offset centre', () => {
      const lots = subdivideGreen(offGreen, 10, 22, new SeededRandom(1));
      for (const l of lots) {
        const toCentre = (Math.atan2(
          offCentre.x - l.front.x,
          -(offCentre.y - l.front.y),
        ) * 180) / Math.PI;
        const want = (toCentre + 360) % 360;
        const diff = Math.abs(((l.bearingDeg - want + 540) % 360) - 180);
        expect(diff).toBeLessThan(2);
      }
    });

    it('surrounds the offset centre rather than the origin', () => {
      const lots = subdivideGreen(offGreen, 10, 22, new SeededRandom(1));
      // Every lot lies at the drawn rim of the offset centre — outside the
      // drawn turf, ringed around it (gate 2 moved the ring inside the
      // NOMINAL radius, onto the drawn edge, so compare against that).
      for (const l of lots) {
        const d = Math.hypot(l.front.x - offCentre.x, l.front.y - offCentre.y);
        expect(d).toBeGreaterThan((offGreen.diameter / 2) * GREEN_JOIN_RATIO);
      }
      // The mean of the ring's fronts lands near the offset centre, not (0,0).
      const meanX = lots.reduce((s, l) => s + l.front.x, 0) / lots.length;
      const meanY = lots.reduce((s, l) => s + l.front.y, 0) / lots.length;
      expect(Math.hypot(meanX - offCentre.x, meanY - offCentre.y)).toBeLessThan(2);
      expect(Math.hypot(meanX, meanY)).toBeGreaterThan(40);
    });
  });
});
