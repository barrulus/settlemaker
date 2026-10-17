import { describe, expect, it } from 'vitest';
import { blockLayout } from '../src/settlement/layouts.js';
import { resolveDevelopment } from '../src/settlement/development.js';
import { ARTWORK_INK, ARTWORK_MANIFEST } from '../src/assets/artwork.js';
import { WardType } from '../src/types/interfaces.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import tetlapan from './fixtures/tetlapan-coast.json';

describe('planned harbour warehouse artwork', () => {
  it.each([
    { input: tetlapan.burg as AzgaarBurgInput, seed: tetlapan.seed },
    { input: { ...tetlapan.burg, population: 4000, oceanBearing: 90, capital: false, citadel: false } as AzgaarBurgInput, seed: 2 },
  ])('fits warehouse roofs to every planned storage footprint ($input.population)', ({ input, seed }) => {
    const layout = blockLayout(input, seed, resolveDevelopment(input.population, input.walls, { preset: 'city' }));
    const warehouses = layout.scene.layers.buildings.filter(b => b.kind === WardType.Harbour);
    expect(warehouses.length).toBeGreaterThan(0);
    for (const building of warehouses) {
      const symbol = layout.scene.layers.symbols.find(s => s.buildingId === building.id);
      expect(symbol, `warehouse ${building.id} must have native roof artwork`).toBeDefined();
      expect(building.glyphBacked).toBe(true);
      const meta = ARTWORK_MANIFEST[symbol!.id], ink = ARTWORK_INK[symbol!.id];
      expect(meta.family).toBe('warehouse');
      // Keep the ordinary guarded fit and useful physical scale. Recovering a
      // harbour roof must not enlarge its art beyond its own reserved building.
      const width = symbol!.scale, height = symbol!.scaleY ?? width;
      expect(Math.min(width, height)).toBeGreaterThan(8);
      expect(Math.max(width, height)).toBeLessThanOrEqual(16 * 1.35 + 1e-8);
      const area = building.ring.reduce((sum, a, i) => {
        const b = building.ring[(i + 1) % building.ring.length];
        return sum + a.x * b.y - b.x * a.y;
      }, 0) / 2;
      expect(ink.area * width * height / 4096).toBeGreaterThan(Math.abs(area) * .5);
      const angle = symbol!.rotationDeg * Math.PI / 180;
      for (const x of [ink.bounds[0], ink.bounds[2]]) for (const y of [ink.bounds[1], ink.bounds[3]]) {
        const dx = (x - meta.anchor[0]) * width / 64, dy = (y - meta.anchor[1]) * height / 64;
        const p = { x: symbol!.at.x + dx * Math.cos(angle) - dy * Math.sin(angle),
          y: symbol!.at.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
        for (const [i, a] of building.ring.entries()) {
          const b = building.ring[(i + 1) % building.ring.length];
          expect(((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) * Math.sign(area)).toBeGreaterThanOrEqual(-1e-7);
        }
      }
    }
  });
});
