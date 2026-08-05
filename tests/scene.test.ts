import { describe, it, expect } from 'vitest';
import { generateFromBurg } from '../src/index.js';
import { buildScene } from '../src/scene/build-scene.js';
import { SCENE_VERSION } from '../src/scene/scene.js';
import { toprak } from './fixtures/toprak.js';

describe('buildScene', () => {
  const result = generateFromBurg(toprak);
  const scene = buildScene(result.model, { shift: result.originShift });

  it('carries version, identity, and bounds', () => {
    expect(scene.version).toBe(SCENE_VERSION);
    expect(scene.population).toBe(13);
    expect(scene.bounds.max_x).toBeGreaterThan(scene.bounds.min_x);
  });

  it('water rings are output-frame (match the fixture coastline)', () => {
    expect(scene.layers.water.rings.length).toBe(1);
    expect(scene.layers.water.synthetic).toBe(false);
    const xs = scene.layers.water.rings[0].map(p => p.x);
    expect(Math.min(...xs)).toBeCloseTo(40, 0); // fixture shoreline
  });

  it('roads carry kinds; buildings carry ward kinds', () => {
    expect(scene.layers.roads.filter(r => r.kind === 'road').length).toBe(1);
    expect(scene.layers.buildings.length).toBeGreaterThan(0);
    for (const b of scene.layers.buildings) {
      expect(typeof b.kind).toBe('string');
      expect(b.ring.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('is pure: building twice gives deep-equal scenes', () => {
    const again = buildScene(result.model, { shift: result.originShift });
    expect(again).toEqual(scene);
  });

  it('synthetic flag set for oceanBearing burgs', () => {
    const bearing = generateFromBurg({ ...toprak, name: 'ToprakB', coastlineGeometry: undefined, oceanBearing: 90 });
    const s2 = buildScene(bearing.model, { shift: bearing.originShift });
    expect(s2.layers.water.synthetic).toBe(true);
    expect(s2.layers.water.rings.length).toBe(1);
  });
});
