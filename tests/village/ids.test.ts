import { describe, it, expect } from 'vitest';
import { armLaneId, branchLaneId, lotId, buildingId } from '../../src/village/types.js';

describe('stable ids', () => {
  it('names an arm by its bearing, not its index', () => {
    expect(armLaneId(90)).toBe('arm-090');
    expect(armLaneId(7.4)).toBe('arm-007');
    expect(armLaneId(359.6)).toBe('arm-000'); // wraps
  });

  it('names a branch by its parent and where it left it', () => {
    expect(branchLaneId('arm-090', 0.5)).toBe('arm-090/b50');
    expect(branchLaneId('arm-090/b50', 0.33)).toBe('arm-090/b50/b33');
  });

  it('names a lot by lane, side and ordinal from the green', () => {
    expect(lotId('arm-090', 1, 0)).toBe('arm-090:R0');
    expect(lotId('arm-090', -1, 12)).toBe('arm-090:L12');
  });

  it('names a building by its lot', () => {
    expect(buildingId('arm-090:R0')).toBe('bld:arm-090:R0');
  });

  it('produces the same id for the same structure regardless of call order', () => {
    const a = lotId(branchLaneId(armLaneId(90), 0.5), 1, 3);
    const b = lotId(branchLaneId(armLaneId(90), 0.5), 1, 3);
    expect(a).toBe(b);
    expect(a).toBe('arm-090/b50:R3');
  });
});
