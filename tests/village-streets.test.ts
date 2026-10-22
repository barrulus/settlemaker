import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createSettlementModel, exportSettlement, renderSettlement } from '../src/index.js';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { SCENE_VERSION, type Scene } from '../src/scene/scene.js';
import { createSceneIndex } from '../src/scene/spatial-index.js';
import { roadFixture } from './fixtures/village-roads.js';

function scene(): Scene {
  return { version: SCENE_VERSION, seed: 1, population: 150, biome: 'temperate', metersPerUnit: 1,
    bounds: { min_x: -30, min_y: -10, max_x: 30, max_y: 10 },
    layers: { water: { rings: [], synthetic: false }, buildings: [], symbols: [], vegetation: [],
      fields: [], furrows: [], greens: [], piers: [], walls: [], roads: [] } };
}

async function raster(s: Scene) {
  const svg = assembleSvg(s, { preciseBounds: true, theme: { roadCore: '#ddddaa', roadCasing: '#ff0000' } });
  const { data, info } = await sharp(Buffer.from(svg)).resize(1200, 400).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => {
    const offset = (Math.floor((y + 10) * 20) * info.width + Math.floor((x + 30) * 20)) * info.channels;
    return [...data.subarray(offset, offset + 3)];
  };
}
describe('paved village streets in the public renderer', () => {
  it('retains the casing along a taper instead of cutting through the road core', async () => {
    const s = scene();
    s.layers.roads = [
      { kind: 'road', width: 8, taper: [8, 2], path: [{x:-30,y:0},{x:0,y:0}] },
      { kind: 'alley', width: 2, path: [{x:0,y:0},{x:30,y:0}] },
    ];
    const pixel = await raster(s);
    expect(pixel(-3, 0)).toEqual([221, 221, 170]);
    expect(pixel(-3, 1.5)).toEqual([255, 0, 0]);
    expect(pixel(0, 0)).toEqual([221, 221, 170]);
  });

  it('merges the paved common over road borders in the same material', async () => {
    const s = scene();
    s.layers.roads = [{ kind:'alley',width:4,path:[{x:-30,y:0},{x:30,y:0}] }];
    s.layers.greens = [{ surface:'paved',ring:[{x:-6,y:-5},{x:6,y:-5},{x:6,y:5},{x:-6,y:5}] }];
    const pixel = await raster(s);
    expect(pixel(0, 1.8)).toEqual([221, 221, 170]);
    expect(pixel(0, 4)).toEqual(pixel(0, 0));
  });

  it('keeps taper geometry when the connected street is outside the viewport', () => {
    const s = scene();
    s.layers.roads = [
      { kind:'road',width:8,taper:[8,2],path:[{x:-30,y:0},{x:0,y:0}] },
      { kind:'alley',width:2,path:[{x:0,y:0},{x:30,y:0}] },
    ];
    const crop = createSceneIndex(s).query({min_x:-24,min_y:-4,max_x:-12,max_y:4});
    expect(crop.layers.roads).toHaveLength(1);
    const shape = (svg: string) => svg.match(/class="surface-core" d="([^"]+)"/)?.[1];
    expect(shape(assembleSvg(crop))).toBe(shape(assembleSvg(s)));
  });

  it('keeps house connections, taper widths and paving in the physical model and export', () => {
    const model = createSettlementModel(roadFixture(150, {walls:true,roadBearings:[0,90,270]}), {seed:2,development:{preset:'village'}});
    const access = model.scene.layers.roads.filter(r => r.access);
    expect(access).toHaveLength(model.buildings.length);
    for (const b of model.buildings) expect(access.some(r => r.id === `access:${b.id}`)).toBe(true);
    expect(model.scene.layers.roads.some(r => r.taper)).toBe(true);
    expect(model.scene.layers.greens.some(g => g.surface === 'paved')).toBe(true);
    const exported = exportSettlement(model);
    expect(exported.features.filter(f => f.properties?.access)).toHaveLength(access.length);
    expect(exported.features.some(f => f.properties?.taper_widths_m)).toBe(true);
    const svg = renderSettlement(model, {detail:'full'});
    // Adjacent road crossings can share a single merged wall opening.
    const jambs = (svg.match(/data-gate="jamb"/g) ?? []).length;
    expect(jambs).toBeGreaterThanOrEqual(2);
    expect(jambs).toBeLessThanOrEqual(model.scene.layers.walls[0].gates.length * 2);
    expect((svg.match(/data-access=/g) ?? []).length).toBe(access.length);
  });
});
