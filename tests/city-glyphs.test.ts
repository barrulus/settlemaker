import { describe, expect, it } from 'vitest';
import { generateSettlement } from './helpers/layout-output.js';
import { buildScene } from '../src/scene/build-scene.js';
import { generateGeoJson } from '../src/output/geojson-builder.js';
import { Point, Polygon, generateSettlement as generatePublicSettlement } from '../src/index.js';
import type { AzgaarBurgInput } from '../src/index.js';
import { placeCityGlyphs, fitCityGlyph } from '../src/generator/city-glyphs.js';
import { ARTWORK_INK as REFINED_INK, ARTWORK_MANIFEST as REFINED_MANIFEST } from '../src/assets/artwork.js';
import achermers from './fixtures/achermers-oversized-temple.json';
import { blocksAccess, polygonsOverlap } from '../src/generator/city-frontage.js';

export const cityInput: AzgaarBurgInput = {
  name: 'City glyph baseline', population: 2500, biome: 'temperate',
  walls: true, plaza: true, temple: true, port: false, citadel: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 18, kind: 'main', route_id: 'a' },
    { bearing_deg: 142, kind: 'town', route_id: 'b' },
    { bearing_deg: 267, kind: 'local', route_id: 'c' },
  ],
};

function city(overrides: Partial<AzgaarBurgInput> = {}) {
  const result = generateSettlement({ ...cityInput, ...overrides }, { seed: 2 });
  if (result.kind !== 'settlement') throw new Error('expected city');
  return result;
}

describe('city artwork integration', () => {
  it.each(['temperate', 'desert', 'tundra', 'tropical', 'coastal'])(
    'renders suburban dwellings as glyphs instead of footprint blocks in %s', biome => {
      for (const seed of [2,7]) {
        const {model}=generatePublicSettlement({...cityInput,engine:'city',biome},{seed});
        const homes=model.buildings.filter(b=>b.urbanity<.6);
        const symbols=model.scene.layers.symbols;
        const backed=new Set(symbols.flatMap(s=>s.buildingIds??(s.buildingId?[s.buildingId]:[])));
        expect(homes.length).toBeGreaterThan(100);
        // These suburbs previously left most homes as flat coloured polygons.
        // Only genuinely unfittable corners or inaccessible sites may remain.
        expect(homes.filter(b=>backed.has(b.id)).length/homes.length).toBeGreaterThan(.94);
        const cottages=symbols.filter(s=>s.id.startsWith('sm-house'));
        expect(cottages.length).toBeGreaterThan(40);
        expect(new Set(cottages.map(s=>s.artworkVariant)).size).toBe(8);
        for(const house of cottages) {
          const meta=REFINED_MANIFEST[house.id], [w,h]=meta.footprint!;
          expect(Math.max(house.scale/w,(house.scaleY??house.scale)/h)).toBeLessThanOrEqual(1.35+1e-7);
          const building=model.scene.layers.buildings.find(b=>b.id===house.buildingId)!;
          const polygon=new Polygon(building.ring.map(p=>new Point(p.x,p.y)));
          const [x0,y0,x1,y1]=REFINED_INK[house.id].bounds, a=house.rotationDeg*Math.PI/180;
          for(const [x,y] of [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]) {
            const dx=(x-meta.anchor[0])*house.scale/64,dy=(y-meta.anchor[1])*(house.scaleY??house.scale)/64;
            const at=new Point(house.at.x+dx*Math.cos(a)-dy*Math.sin(a),house.at.y+dx*Math.sin(a)+dy*Math.cos(a));
            polygon.forEdge((p,q)=>expect(((q.x-p.x)*(at.y-p.y)-(q.y-p.y)*(at.x-p.x))*Math.sign(polygon.square)).toBeGreaterThanOrEqual(-1e-7));
          }
        }
        expect(model.residents.unassigned).toBe(0);
      }
    },
  );

  it('keeps the Achermers temple within its physical size limit on the web generation path', () => {
    const result=generateSettlement(achermers.burg as AzgaarBurgInput,{seed:achermers.seed});
    if(result.kind!=='settlement')throw new Error('expected legacy city');
    expect(result.model.params.development).toBeUndefined();
    const scene=buildScene(result.model,{shift:result.originShift});
    const temples=result.model.symbols.filter(s=>REFINED_MANIFEST[s.id]?.category==='faith');
    expect(temples).toHaveLength(1);
    const temple=temples[0];
    expect(temple.id).toBe('sm-city-temple-hall');
    const longest=Math.max(temple.scale,temple.scaleY??temple.scale)*scene.metersPerUnit!;
    expect(longest).toBeLessThanOrEqual(20+1e-7);
    expect(longest).toBeGreaterThan(8);
    const ward=result.model.patches.find(p=>p.ward?.principalBuilding===temple.building)!.ward!;
    expect(ward.principalSymbol).toBe(temple);
    for(const building of ward.geometry)if(building!==temple.building){
      expect(polygonsOverlap(building,temple.building!)).toBe(false);
      expect(blocksAccess(temple.building!.centroid,temple.frontage!.at,building)).toBe(false);
    }
  });

  it.each([[1001, 182], [2500, 312], [10000, 953], [50000, 3902], [250000, 7777]])(
    'meets or exceeds the pre-layout building count at population %i within its budget', (population, count) => {
      const { model } = city({ population });
      expect(model.countOrdinaryBuildingsPublic()).toBeGreaterThanOrEqual(count);
      expect(model.countOrdinaryBuildingsPublic()).toBeLessThanOrEqual(model.getBuildingCapacity().target);
      expect(model.symbols.filter(s => s.building).length).toBeGreaterThan(count * 0.5);
    },
  );

  it.each(['temperate', 'desert', 'tundra', 'tropical', 'coastal'])(
    'fits the entire guarded painted box inside its footprint in %s', biome => {
      const { model } = city({ biome });
      const placements = model.symbols.filter(s => s.building);
      expect(placements.length).toBeGreaterThan(100);
      for (const s of placements) {
        const compound = s.buildings && model.patches.flatMap(p=>p.ward?.compounds??[])
          .find(compound=>compound.buildings[0]===s.building);
        const polygon = compound?.site ?? s.building!, [x0, y0, x1, y1] = REFINED_INK[s.id].bounds;
        const anchor = REFINED_MANIFEST[s.id].anchor;
        const angle = s.rotationDeg * Math.PI / 180;
        for (const [x, y] of [[x0, y0], [x0, y1], [x1, y0], [x1, y1]]) {
          const dx = (x - anchor[0]) * s.scale / 64, dy = (y - anchor[1]) * s.scaleY! / 64;
          const p = new Point(s.at.x + dx * Math.cos(angle) - dy * Math.sin(angle), s.at.y + dx * Math.sin(angle) + dy * Math.cos(angle));
          polygon.forEdge((a, b) => {
            const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
            expect(cross * Math.sign(polygon.square), s.id).toBeGreaterThanOrEqual(-1e-7);
          });
        }
        if (/house|hut|inn/.test(s.id) && biome !== 'temperate') expect(s.id).toContain(`--${biome}`);
      }
    },
  );

  it('keeps scene, shifted glyphs and GeoJSON building identity in agreement', () => {
    const { model } = city();
    const shift = { dx: 12, dy: -7, source: 'coast_pull' as const };
    const scene = buildScene(model, { shift });
    const features = generateGeoJson(model, { shift }).features;
    for (const s of scene.layers.symbols.filter(s => s.buildingId)) {
      const building = scene.layers.buildings.find(b => b.id === s.buildingId)!;
      const feature = features.find(f => f.properties?.building_id === s.buildingId)!;
      expect(feature.geometry.type).toBe('Polygon');
      if (feature.geometry.type === 'Polygon') {
        expect(feature.geometry.coordinates[0].slice(0, -1)).toEqual(building.ring.map(p => [p.x, p.y]));
      }
      expect(building.glyphBacked).toBe(true);
    }
    const linked = model.symbols.find(s => s.building)!;
    const shifted = scene.layers.symbols.find(s => s.buildingId === scene.layers.buildings.find(b => b.ring[0].x === linked.building!.vertices[0].x + 12)?.id)!;
    expect(shifted.at).toEqual({ x: linked.at.x + 12, y: linked.at.y - 7 });
  });

  it('rebuilding removes stale placements and is deterministic', () => {
    const { model } = city();
    const before = JSON.stringify(buildScene(model));
    placeCityGlyphs(model);
    expect(JSON.stringify(buildScene(model))).toBe(before);
    const removed = model.symbols.find(s => s.building)!.building!;
    const ward = model.patches.find(p => p.ward?.geometry.includes(removed))!.ward!;
    ward.geometry = ward.geometry.filter(b => b !== removed);
    placeCityGlyphs(model);
    expect(model.symbols.some(s => s.building === removed)).toBe(false);
    expect(model.glyphBackedBuildings.has(removed)).toBe(false);
  });

  it('rejects a narrow lot rather than shrinking a dwelling to a sliver', () => {
    const thin = new Polygon([new Point(0, 0), new Point(10, 0), new Point(10, 0.1), new Point(0, 0.1)]);
    expect(fitCityGlyph(thin, 'sm-house', 1)).toBeNull();
  });

  it('recovers a tapered lot by translating useful-sized artwork and checking its actual front door', () => {
    const site=new Polygon([[0,0],[6,0],[2,6],[0,6]].map(([x,y])=>new Point(x,y)));
    const frontage={a:new Point(0,-1),b:new Point(6,-1),at:new Point(site.centroid.x,-1),width:1,kind:'street' as const};
    expect(fitCityGlyph(site,'sm-city-row-house-a',1,frontage,.5,1.35,1.25)).toBeNull();
    let checked=0;
    const fit=fitCityGlyph(site,'sm-city-row-house-a',1,frontage,.5,1.35,1.25,(door,street)=>{
      checked++;
      expect(street).toBe(frontage.at);
      expect(door.y).toBeLessThan(site.centroid.y);
      return true;
    },true)!;
    expect(fit).not.toBeNull();
    expect(checked).toBeGreaterThan(0);
    expect(fit.paintedArea).toBeGreaterThan(Math.abs(site.square)*.5);
    expect(fit.scale).toBeGreaterThan(5);
    // The rejected centred candidate is already frontage-parallel: its
    // translated replacement must still invoke the new doorway check.
    expect(fitCityGlyph(site,'sm-city-row-house-a',1,frontage,.5,1.35,1.25,()=>false,true)).toBeNull();
    expect(fitCityGlyph(site,'sm-city-row-house-a',1,frontage,.5,.25,1.25,()=>true,true)).toBeNull();
  });

  it('omits phase 1-only art from the default SVG', () => {
    const { svg } = city({ population: 10000 });
    for (const id of ['sm-mark-church', 'sm-mill-wind', 'sm-market-cross', 'sm-tree-deciduous-round']) {
      expect(svg).not.toContain(`glyph-${id}`);
    }
    expect(svg).toContain('--sm-city-temperate-roof');
  });
});
