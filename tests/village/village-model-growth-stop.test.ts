import { describe, expect, it, vi } from 'vitest';
import { blockAreas } from '../../src/village/skeleton/blocks.js';
import { generateVillage } from '../../src/village/village-model.js';
import { roadFixture } from '../fixtures/village-roads.js';
vi.mock('../../src/village/skeleton/blocks.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/village/skeleton/blocks.js')>(), blockAreas: vi.fn(() => []),
}));
describe('housing ends growth independently of enclosed block counts', () => {
  it('does not resume building roads to meet a compulsory block floor', () => {
    const m = generateVillage(roadFixture(300), 1);
    expect(m.buildings.reduce((s, b) => s + b.occupancy, 0)).toBeGreaterThanOrEqual(300);
    expect(blockAreas).not.toHaveBeenCalled();
    expect(m.diagnostics.some(d => d.startsWith('blocks short:'))).toBe(false);
  });
});
