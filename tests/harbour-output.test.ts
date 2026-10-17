import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { createSceneIndex } from '../src/scene/spatial-index.js';
import { createSettlementSession } from '../src/output/session.js';
import type { HarbourFeature, Scene } from '../src/scene/scene.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import { PALETTE_BLUEPRINT } from '../src/output/palette.js';
import tetlapan from './fixtures/tetlapan-coast.json';

const rect = (x: number, y: number, w: number, h: number) =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function fixture(): Scene {
  const harbour: HarbourFeature = { id: 'harbour:0', kind: 'protected',
    basin: rect(6, 0, 50, 50), entrance: [{ x: 40, y: 50 }, { x: 56, y: 50 }], approach: [], navigationWidth: 12,
    quays: [{ ring: rect(0, -10, 60, 10), edge: [{ x: 0, y: 0 }, { x: 60, y: 0 }] }],
    breakwaters: [{ ring: rect(0, 0, 6, 60), path: [{ x: 3, y: 0 }, { x: 3, y: 60 }], width: 6 }],
    berths: [{ ring: rect(20, -.5, 4, 18) }], access: [], fixtures: [
      { kind: 'crane', at: { x: 66, y: -5 }, angle: 0 },
      { kind: 'beacon', at: { x: 3, y: 58 }, angle: 0 },
    ] };
  return { version: 2, seed: 1, population: 2000, biome: 'temperate', metersPerUnit: 1,
    bounds: { min_x: -30, min_y: -30, max_x: 90, max_y: 90 }, layers: {
      water: { rings: [rect(-100, 0, 300, 300)], synthetic: false, shorelines: [[{ x: -100, y: 0 }, { x: 200, y: 0 }]] },
      harbours: [harbour], piers: [{ ring: harbour.berths[0].ring, harbourId: harbour.id }],
      fields: [], furrows: [], greens: [], vegetation: [], symbols: [], buildings: [], walls: [],
      roads: [{ kind: 'alley', width: 2, path: [{ x: -10, y: 30 }, { x: 20, y: 30 }] }],
    } };
}
async function pixels(svg: string) {
  return sharp(Buffer.from(svg.replace('<svg ', '<svg width="240" height="240" '))).ensureAlpha().raw().toBuffer();
}

describe('harbour rendering and export contracts', () => {
  it('retains fixture ink and deck detail through cropped scene queries without duplicate pier painting', async () => {
    const scene = fixture(), before = JSON.stringify(scene), index = createSceneIndex(scene);
    for (const bounds of [
      { min_x: 70.7, min_y: -5.3, max_x: 72.7, max_y: -3.3 }, // crane tip beyond ordinary culling padding
      { min_x: 18, min_y: 10, max_x: 26, max_y: 18 }, // timber deck edge
      { min_x: -2, min_y: -3, max_x: 8, max_y: 7 }, // quay/mole junction
      { min_x: 15, min_y: 25, max_x: 23, max_y: 33 }, // open water with road masked away
    ]) for (const palette of [undefined, PALETTE_BLUEPRINT]) {
      const appearance = { palette, pixelsPerUnit: 4, preciseBounds: true };
      const cropped = assembleSvg(index.query(bounds, appearance), appearance);
      const reference = assembleSvg({ ...scene, bounds }, appearance);
      expect(await pixels(cropped)).toEqual(await pixels(reference));
      expect(cropped).not.toContain('class="pier"');
    }
    expect(index.query({ min_x: 500, min_y: 500, max_x: 510, max_y: 510 }).layers.harbours).toHaveLength(0);
    expect(JSON.stringify(scene)).toBe(before);
  });

  it('permits road ink on constructed decks but keeps the adjoining water clear', async () => {
    const scene = fixture();
    scene.bounds = { min_x: 0, min_y: 20, max_x: 20, max_y: 40 };
    const data = await pixels(assembleSvg(scene, { theme: { roadCore: '#ff0000' }, preciseBounds: true }));
    const rgb = (x: number, y: number) => [...data.subarray((y * 240 + x) * 4, (y * 240 + x) * 4 + 3)];
    expect(rgb(36, 120)).toEqual([255, 0, 0]); // x=3: solid breakwater
    expect(rgb(120, 120)).not.toEqual([255, 0, 0]); // x=10: water
  });

  it('exports the same metre-space harbour structures and navigation as the scene, without viewport mutations', () => {
    const session = createSettlementSession(tetlapan.burg as AzgaarBurgInput, { seed: tetlapan.seed });
    const harbour = session.scene.layers.harbours![0], exported = session.exportGeoJson();
    expect(harbour).toBeDefined();
    const feature = (id: string) => exported.features.find(f => f.id === id)!;
    const coordinates = (ring: { x: number; y: number }[]) => [...ring, ring[0]].map(p => [p.x, p.y]);
    expect(feature(`${harbour.id}:basin`).geometry).toEqual({ type: 'Polygon', coordinates: [coordinates(harbour.basin)] });
    expect(feature(`${harbour.id}:basin`).properties?.navigation_width_m).toBe(harbour.navigationWidth);
    expect(feature(`${harbour.id}:approach`).geometry).toEqual({ type: 'LineString', coordinates: harbour.approach.map(p => [p.x, p.y]) });
    for (const [i, quay] of harbour.quays.entries()) expect(feature(`${harbour.id}:quay:${i}`).geometry)
      .toEqual({ type: 'Polygon', coordinates: [coordinates(quay.ring)] });
    for (const [i, mole] of harbour.breakwaters.entries()) {
      expect(feature(`${harbour.id}:breakwater:${i}`).geometry).toEqual({ type: 'Polygon', coordinates: [coordinates(mole.ring)] });
      expect(feature(`${harbour.id}:breakwater:${i}`).properties?.width).toBe(mole.width);
    }
    for (const [i, berth] of harbour.berths.entries()) {
      const pier = session.scene.layers.piers.filter(p => p.harbourId === harbour.id)[i];
      expect(pier.ring).toEqual(berth.ring); // mesh-to-metre conversion happens exactly once in each layer
      const exportedPier = exported.features.find(f => f.properties?.layer === 'pier'
        && f.properties?.harbour_id === harbour.id && JSON.stringify(f.geometry) === JSON.stringify({ type: 'Polygon', coordinates: [coordinates(berth.ring)] }));
      expect(exportedPier).toBeDefined();
    }
    for (const [i, fixture] of harbour.fixtures.entries()) {
      expect(feature(`${harbour.id}:fixture:${i}`).geometry).toEqual({ type: 'Point', coordinates: [fixture.at.x, fixture.at.y] });
      expect(feature(`${harbour.id}:fixture:${i}`).properties?.bearing_deg).toBe(fixture.angle);
    }
    const before = JSON.stringify(session.scene);
    session.renderView({ bounds: { min_x: -10000, min_y: -10000, max_x: 10000, max_y: 10000 }, width: 800 });
    expect(JSON.stringify(session.scene)).toBe(before);
    expect(session.exportGeoJson()).toEqual(exported);
  });
});
