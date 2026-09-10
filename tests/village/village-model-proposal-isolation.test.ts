import { describe, expect, it } from 'vitest';
import { Point } from '../../src/types/point.js';
import { SeededRandom } from '../../src/utils/random.js';
import { proposeGrowth } from '../../src/village/skeleton/lanes.js';
import { circularProfile } from '../../src/village/skeleton/profile.js';
import type { Green, Lane } from '../../src/village/types.js';
describe('growth candidate isolation', () => {
  it('does not mutate standing roads when candidates extend or branch them', () => {
    const lanes: Lane[] = [{ id: 'lane-090', type: 'local', widthM: 2, points: [new Point(0, 0), new Point(30, 0)] }];
    const before = JSON.stringify(lanes);
    const green: Green = { centre: new Point(0, 0), diameter: 12, bearingDeg: 0, shape: 'sm-green-round', variant: 'a' };
    const candidates = proposeGrowth(lanes, green, 6, circularProfile(60), new SeededRandom(1));
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) candidate[0].points = [...candidate[0].points, new Point(100, 0)];
    expect(JSON.stringify(lanes)).toBe(before);
  });
});
