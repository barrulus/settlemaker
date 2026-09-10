import { describe, expect, it } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { frontageOffsetM, roadCrossSection, villageCrossSection } from '../../src/village/cross-section.js';
import { subdivideLane } from '../../src/village/parcels/lots.js';
import type { Green, Lane } from '../../src/village/types.js';
const lane: Lane = { id: 'local-street', type: 'local', widthM: 3.5, points: [new Point(0, 0), new Point(80, 0)] };
describe('road cross sections', () => {
  it('preserves the old corridor and paint interpretation for supplied models', () => {
    expect(roadCrossSection(lane)).toEqual({ corridorM: 3.5, surfaceM: 1.9250000000000003, setbackM: 1 });
  });
  it('gives a small access lane both a narrower surface and closer frontage', () => {
    const access = villageCrossSection(lane, 8);
    expect(roadCrossSection(access).surfaceM).toBeCloseTo(1.2);
    expect(frontageOffsetM(access)).toBeLessThan(frontageOffsetM(lane));
    const green: Green = { centre: new Point(-100, -100), diameter: 10, bearingDeg: 0, shape: 'sm-green-round', variant: 'a' };
    const lots = subdivideLane(access, green, 300, 6, 12, new SeededRandom(1));
    expect(lots.length).toBeGreaterThan(0);
    for (const lot of lots) expect(Math.abs(lot.front.y)).toBeCloseTo(frontageOffsetM(access));
  });
  it('preserves an explicit regional road even through a tiny hamlet', () => {
    const trunk = { ...lane, id: 'trunk-royal-0', type: 'royal' as const, widthM: 6 };
    expect(villageCrossSection(trunk, 8)).toBe(trunk);
    expect(roadCrossSection(trunk).surfaceM).toBe(6);
  });
});
