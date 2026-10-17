import {cityUrbanity} from '../src/generator/city-character.js';
import {resolveGlyphFor} from '../src/village/deck.js';
import { buildingIds } from '../src/output/id-allocator.js';
import { describe, expect, it } from 'vitest';
import { generateSettlement } from './helpers/layout-output.js';
import { buildScene } from '../src/scene/build-scene.js';
import { Point, Polygon } from '../src/index.js';
import { WardType } from '../src/types/interfaces.js';
import { cityArchitecture } from '../src/generator/city-glyphs.js';
import { ARTWORK_MANIFEST, ARTWORK_INK } from '../src/assets/artwork.js';
import { blocksAccess, nearestOnSegment, segmentInside, drySegments, wardFrontages } from '../src/generator/city-frontage.js';
import { Park } from '../src/wards/park.js';
import { createAlleys } from '../src/wards/ward.js';
import { SeededRandom } from '../src/utils/random.js';
import type { WardLane } from '../src/wards/ward.js';

function city(population: number, seed: number, biome = 'temperate', temple = true) {
  const r = generateSettlement({ name: 'Neighbourhood', population, biome, walls: true, plaza: true,
    temple, port: false, citadel: false, shanty: false, capital: false }, { seed });
  if (r.kind !== 'settlement') throw new Error('expected city');
  return r;
}

describe('city neighbourhoods', () => {
  it.each(['temperate', 'desert', 'tundra', 'tropical', 'coastal'])(
    '%s retains its central home style, mixes rural outskirts and preserves temple identity', biome => {
      for (const seed of [1, 2, 3, 101, 102, 103]) {
        const { model, geojson } = city(10000, seed, biome);
        const architecture = cityArchitecture(model.params.seed, biome);
        const ids=buildingIds(model);
        const poiBuildings=new Set(geojson.features.filter(f=>f.properties?.layer==='poi').map(f=>f.properties?.building_id));
        const homes = model.symbols.filter(s => s.building && !poiBuildings.has(ids.get(s.building)) && [WardType.Craftsmen, WardType.Merchant, WardType.GateWard, WardType.Farm].includes(s.wardType!));
        expect(homes.length).toBeGreaterThan(100);
        const allowed=new Set([architecture.home,architecture.dense,resolveGlyphFor(biome,'sm-house'),resolveGlyphFor(biome,'sm-house-tiled')]);
        const metres=buildScene(model).metersPerUnit!;
        for(const home of homes){
          expect(allowed.has(home.id)).toBe(true);
          const patch=model.patches.find(p=>p.ward?.geometry.includes(home.building!))!;
          const urbanity=cityUrbanity(model,patch);
          if(urbanity>=.45)expect([architecture.home,architecture.dense]).toContain(home.id);
          if(home.id===architecture.dense){
            expect(urbanity).toBeGreaterThanOrEqual(.7);
            expect(Math.min(home.scale,home.scaleY!)*metres).toBeGreaterThanOrEqual(10.4);
            expect(Math.max(home.scale,home.scaleY!)*metres).toBeLessThanOrEqual(16*1.35);
          }
        }
        expect(homes.some(s=>s.id===architecture.dense)).toBe(true);
        expect(homes.some(s=>s.id.startsWith('sm-house'))).toBe(true);
        const temples = model.symbols.filter(s => /cathedral|chapel|temple|church/.test(s.id));
        expect(temples, `seed ${seed}`).toHaveLength(1);
        const pois = geojson.features.filter(f => f.properties?.layer === 'poi' && ['cathedral', 'chapel', 'temple'].includes(f.properties.kind));
        expect(pois).toHaveLength(1);
        const scene = buildScene(model);
        const temple = scene.layers.symbols.find(s => s.id === temples[0].id)!;
        expect(temple.buildingId).toBe(pois[0].properties!.building_id);
        const nominal=ARTWORK_MANIFEST[temple.id].footprint!;
        const limit=temple.id.includes('cathedral')?1.75:1.25;
        expect(temple.scale*scene.metersPerUnit!/nominal[0]).toBeLessThanOrEqual(limit+1e-7);
        expect((temple.scaleY??temple.scale)*scene.metersPerUnit!/nominal[1]).toBeLessThanOrEqual(limit+1e-7);
      }
    },
  );

  it('does not invent a temple in a city that did not request one', () => {
    const r = city(10000, 2, 'temperate', false);
    expect(r.model.symbols.filter(s => /cathedral|chapel|temple|church/.test(s.id))).toHaveLength(0);
    expect(r.geojson.features.filter(f => f.properties?.layer === 'poi' && ['cathedral', 'chapel', 'temple'].includes(f.properties.kind))).toHaveLength(0);
  });

  it('does not treat field boundaries as streets when farms have no approach road', () => {
    const { model } = city(2500, 2);
    const farms = model.patches.filter(p => p.ward?.type === WardType.Farm);
    expect(farms.length).toBeGreaterThan(0);
    model.roads = [];
    model.arteries = [];
    for (const patch of farms) expect(wardFrontages(patch.ward!)).toHaveLength(0);
  });

  it('recording alley cuts does not change lots or consume additional random draws', () => {
    const block = new Polygon([new Point(0, 0), new Point(40, 0), new Point(40, 30), new Point(0, 30)]);
    const a = new SeededRandom(11), b = new SeededRandom(11), lanes: WardLane[] = [];
    const before = createAlleys(block, a, 10, 0.5, 0.6, 0.04, true, 0.6, true, Infinity);
    const after = createAlleys(block, b, 10, 0.5, 0.6, 0.04, true, 0.6, true, Infinity, lanes);
    expect(after).toEqual(before);
    expect(a.getSeed()).toBe(b.getSeed());
    expect(lanes.length).toBeGreaterThan(3);
    for (const lane of lanes) {
      expect(lane.width).toBe(0.6);
      for (const building of after) expect(blocksAccess(lane.a, lane.b, building)).toBe(false);
    }
  });

  it('ordinary glyphs face their recorded street or alley without a building blocking access', () => {
    const { model } = city(10000, 2);
    let checked = 0;
    for (const patch of model.patches) {
      const ward = patch.ward;
      if (!ward) continue;
      for (const s of model.symbols.filter(s => s.building && !s.buildings && ward.geometry.includes(s.building))) {
        const f = s.frontage!;
        expect(f).toBeDefined();
        const angle = s.rotationDeg * Math.PI / 180;
        const along = Math.atan2(f.b.y - f.a.y, f.b.x - f.a.x);
        // Rectangular legacy lots may be oblique to the street. They can
        // follow their actual footprint while facing within45° of it.
        expect(Math.abs(Math.sin(angle - along))).toBeLessThanOrEqual(Math.SQRT1_2+1e-8);
        const c = s.building!.centroid;
        expect(-Math.sin(angle) * (f.at.x - c.x) + Math.cos(angle) * (f.at.y - c.y)).toBeGreaterThan(0);
        // Also check the glyph's front edge, rather than assuming that a
        // centroid-to-street segment proves the rotated entrance accessible.
        const {anchor}=ARTWORK_MANIFEST[s.id], [x0,,x1,y1]=ARTWORK_INK[s.id].bounds;
        const dx=((x0+x1)/2-anchor[0])*s.scale/64, dy=(y1-anchor[1])*(s.scaleY??s.scale)/64;
        const door=new Point(s.at.x+dx*Math.cos(angle)-dy*Math.sin(angle),s.at.y+dx*Math.sin(angle)+dy*Math.cos(angle));
        for (const other of ward.geometry) if (other !== s.building) {
          expect(blocksAccess(c, f.at, other)).toBe(false);
          expect(blocksAccess(door, f.at, other),s.id).toBe(false);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it.each([1, 2, 3, 101, 102, 103])('park %i has connected entrances, a clearing, and trees clear of paths', seed => {
    const { model, geojson } = city(10000, seed);
    const park = model.patches.find(p => p.ward instanceof Park)!.ward as Park;
    expect(park.paths.length).toBeGreaterThan(0);
    expect(park.paths[0]).toHaveLength(3);
    for (const path of park.paths) for (let i = 1; i < path.length; i++) {
      expect(segmentInside(path[i - 1], path[i], park.patch.shape)).toBe(true);
    }
    expect(park.trees.length).toBeGreaterThan(0);
    for (const tree of park.trees) for (const path of park.paths) for (let i = 1; i < path.length; i++) {
      expect(Point.distance(tree.at, nearestOnSegment(tree.at, path[i - 1], path[i])))
        .toBeGreaterThanOrEqual(tree.scale / 2 + park.pathWidth / 2);
    }
    const scene = buildScene(model);
    expect(scene.layers.greens.some(g => g.paths?.length === park.paths.length)).toBe(true);
    expect(geojson.features.filter(f => f.properties?.streetType === 'park')).toHaveLength(model.patches.reduce((n,p)=>n+(p.ward instanceof Park?p.ward.paths.length:0),0));
  });

  it('detects narrow concave notches in a proposed park path', () => {
    const polygon = new Polygon([[0, 0], [10, 0], [10, 10], [5.01, 10], [5.01, 3], [5, 3], [5, 10], [0, 10]].map(([x, y]) => new Point(x, y)));
    expect(segmentInside(new Point(2, 5), new Point(8, 5), polygon)).toBe(false);
  });

  it('does not expose a traced alley as a bridge across a thin river', () => {
    const water = [[[4.99, -2], [5.01, -2], [5.01, 2], [4.99, 2]].map(([x, y]) => new Point(x, y))];
    const pieces = drySegments(new Point(0, 0), new Point(10, 0), water);
    expect(pieces).toHaveLength(2);
    expect(pieces[0][1].x).toBeCloseTo(4.99);
    expect(pieces[1][0].x).toBeCloseTo(5.01);
    expect(pieces.flatMap(([a, b]) => drySegments(a, b, water))).toEqual(pieces);
  });
});
