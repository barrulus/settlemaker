import { describe, test, expect } from 'vitest';
import { mapToGenerationParams } from '../src/input/azgaar-input.js';

describe('route character fields', () => {
  test('object bearings carry group/through/relief/followsRiver into RoadEntry', () => {
    const params = mapToGenerationParams({
      name: 'T', population: 4000, port: false, citadel: false, walls: true,
      plaza: true, temple: false, shanty: false, capital: false,
      roadBearings: [
        { bearing_deg: 90, route_id: 'r1', kind: 'road', group: 'roads', through: true, relief: 'valley', followsRiver: true },
        180,
      ],
    }, 1);
    const [rich, bare] = params.roadEntryPoints!;
    expect(rich.group).toBe('roads');
    expect(rich.through).toBe(true);
    expect(rich.relief).toBe('valley');
    expect(rich.followsRiver).toBe(true);
    expect(bare.group).toBeUndefined();
    expect(bare.through).toBeUndefined();
  });
});
