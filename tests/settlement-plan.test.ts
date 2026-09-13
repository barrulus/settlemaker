import { describe, expect, it, vi } from 'vitest';
import { Model } from '../src/generator/model.js';
import { cityUrbanity } from '../src/generator/city-character.js';
import { planSettlement, createSettlementModel, generateSettlement, exportSettlement, renderSettlement, PALETTES, type AzgaarBurgInput } from '../src/index.js';
import { allocateResidents, type SettlementBuilding } from '../src/settlement/model.js';
import { resolveDevelopment } from '../src/settlement/development.js';
import { sceneInView } from '../src/settlement/render-view.js';
import { convexHull } from '../src/village/dressing/parcel-cut.js';
import { Point } from '../src/types/point.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { ARTWORK_MANIFEST } from '../src/assets/artwork.js';
import { blocksAccess } from '../src/generator/city-frontage.js';
import { Polygon } from '../src/geom/polygon.js';

const base: AzgaarBurgInput = { name: 'Appearance review', population: 800, biome: 'temperate', roadBearings: [20, 145, 270],
  walls: true, plaza: true, temple: true, port: false, citadel: false, shanty: false, capital: false };
const area = (r: Array<{x:number;y:number}>) => Math.abs(r.reduce((s,p,i) => { const q=r[(i+1)%r.length]; return s+p.x*q.y-p.y*q.x; },0))/2;

describe('physical settlement planning', () => {
  it.each([2,7])('retains a temple in a small city with fine-grained housing, seed %s', seed => {
    const m=createSettlementModel({...base,population:300},{seed,development:{preset:'city'}});
    const faith=m.scene.layers.symbols.filter(s=>ARTWORK_MANIFEST[s.id]?.category==='faith');
    expect(faith).toHaveLength(1);
    expect(Math.max(faith[0].scale,faith[0].scaleY??faith[0].scale)).toBeGreaterThanOrEqual(4);
    expect(m.residents.unassigned).toBe(0);
  });

  it.each([2,7])('occupies small-city civic blocks and keeps their access clear, seed %s', seed => {
    const m=createSettlementModel({...base,population:2000},{seed,development:{preset:'city'}});
    const L=m.scene.layers;
    expect(m.residents.unassigned).toBe(0);
    const homes=m.buildings.filter(b=>b.insideWalls);
    expect(homes.length).toBeGreaterThanOrEqual(200);
    const sizes=homes.map(b=>area(b.footprint)).sort((a,b)=>a-b);
    expect(sizes[Math.floor(sizes.length/2)]).toBeLessThan(45);
    expect(sizes[Math.floor(sizes.length*.9)]).toBeLessThan(65);
    const faith=L.symbols.filter(s=>ARTWORK_MANIFEST[s.id]?.category==='faith');
    expect(faith).toHaveLength(1);
    expect(Math.max(faith[0].scale,faith[0].scaleY??faith[0].scale)).toBeGreaterThan(12);
    const wall=convexHull(L.walls[0].polylines.flat().map(p=>new Point(p.x,p.y)));
    const enclosed=L.buildings.filter(b=>pointInPolygon(new Point(b.ring[0].x,b.ring[0].y),wall));
    // Measure the whole enclosure, including public wards. Residential-only
    // coverage hid the empty market and temple neighbourhoods in this case.
    expect(enclosed.reduce((s,b)=>s+area(b.ring),0)/area(wall)).toBeGreaterThan(.55);
    const market=L.buildings.filter(b=>b.kind==='market');
    const temple=L.buildings.filter(b=>b.kind==='cathedral');
    expect(market.length).toBeGreaterThan(4);
    expect(temple.length).toBeGreaterThan(4);
    expect(market.every(b=>!b.landmark)).toBe(true);
    const plaza=L.greens.filter(g=>g.surface==='paved');
    expect(plaza).toHaveLength(1);
    expect(area(plaza[0].ring)).toBeLessThanOrEqual(324.000001);
    for(const b of [...market,...temple]){
      const footprint=new Polygon(b.ring.map(p=>new Point(p.x,p.y)));
      for(const r of L.roads)for(let i=1;i<r.path.length;i++){
        expect(blocksAccess(new Point(r.path[i-1].x,r.path[i-1].y),new Point(r.path[i].x,r.path[i].y),footprint)).toBe(false);
      }
    }
  });

  it.each([2,7])('uses denser housing and greater household capacity at the same 800 population, seed %s', seed => {
    const village = planSettlement(base, { seed, development: { preset: 'village' } });
    const city = generateSettlement(base, { seed, development: { preset: 'city' } });
    expect(city.kind).toBe('planned');
    for (const r of [village, city]) {
      expect(r.model.residents.assigned).toBe(800);
      expect(r.model.residents.unassigned).toBe(0);
      expect(r.model.buildings.reduce((s,b) => s+b.residents,0)).toBe(800);
      expect(r.model.buildings.every(b => b.residents >= 0 && b.residents <= b.capacity)).toBe(true);
      expect(r.model.scene.layers.fields.length).toBeGreaterThan(20);
      expect(r.model.scene.layers.vegetation.length).toBeGreaterThan(100);
    }
    expect(city.model.buildings.length).toBeLessThan(village.model.buildings.length);
    const density = (r: typeof city) => r.model.residents.insideWalls.assigned / r.model.districts.filter(d=>d.insideWalls).reduce((s,d)=>s+area(d.boundary),0);
    expect(density(city)).toBeGreaterThan(density(village));
    expect(city.model.buildings.filter(b=>b.insideWalls).every(b=>b.capacity===8)).toBe(true);
    const coreRoof = city.model.buildings.filter(b=>b.insideWalls).reduce((s,b)=>s+area(b.footprint),0);
    const residentialDistricts=new Set(city.model.buildings.filter(b=>b.insideWalls).map(b=>b.districtId));
    const coreLand = city.model.districts.filter(d=>residentialDistricts.has(d.id)).reduce((s,d)=>s+area(d.boundary),0);
    expect(coreRoof/coreLand).toBeGreaterThan(.48);
    expect(city.model.scene.layers.buildings.some(b=>b.kind==='Military')).toBe(false);
    expect(city.svg).toContain('data-surface="paved"');
    const temples=city.model.scene.layers.symbols.filter(s=>ARTWORK_MANIFEST[s.id]?.category==='faith');
    expect(temples).toHaveLength(1);
    expect(temples.every(s=>Math.max(s.scale,s.scaleY??s.scale)<=28)).toBe(true);
  });

  it('exports and draws the same metre geometry, unaffected by theme or framing', () => {
    const r = planSettlement(base, { seed: 2, development: { preset: 'city' } });
    const before = JSON.stringify(r.model);
    const blueprint = renderSettlement(r.model, { palette: PALETTES.blueprint });
    expect(blueprint).toContain('data-px-per-metre="1"');
    expect(blueprint).not.toBe(r.svg);
    expect(JSON.stringify(r.model)).toBe(before);
    const geo = exportSettlement(r.model);
    expect(geo.metadata.coordinate_units).toBe('metres');
    expect(geo.metadata.scale.meters_per_unit).toBe(1);
    for (const b of r.model.scene.layers.buildings) {
      const f = geo.features.find(f=>f.id===b.id)!;
      expect(f.geometry.type).toBe('Polygon');
      if(f.geometry.type==='Polygon') expect(f.geometry.coordinates[0].slice(0,-1)).toEqual(b.ring.map(p=>[p.x,p.y]));
    }
    const roads = geo.features.filter(f=>f.properties?.layer==='street');
    expect(roads.map(f=>f.geometry.type==='LineString'?f.geometry.coordinates:[])).toEqual(r.model.scene.layers.roads.map(r=>r.path.map(p=>[p.x,p.y])));
    const reframed = { ...r.model, scene: { ...r.model.scene, bounds: { min_x:-100,min_y:-100,max_x:100,max_y:100 } } };
    expect(exportSettlement(reframed).features).toEqual(geo.features);
    expect(renderSettlement(reframed)).toContain('viewBox="-100.0 -100.0 200.0 200.0"');
  });

  it('is deterministic including resident allocation and landscape', () => {
    const options = { seed: 7, development: { preset: 'city' as const } };
    expect(planSettlement(base,options)).toEqual(planSettlement(base,options));
  });

  it('accounts for 200,000 residents with exactly 10,000 inside the walls', () => {
    let raw: Model;
    const generate = Model.prototype.generate;
    const capture = vi.spyOn(Model.prototype, 'generate').mockImplementation(function(this: Model) {
      raw = generate.call(this);
      return raw;
    });
    const r = (() => {
      try { return planSettlement({...base,population:200000}, {seed:2,development:{preset:'city',corePopulation:10000}}); }
      finally { capture.mockRestore(); }
    })();
    const occupied = new Set(raw!.patches.filter(p=>['core','suburb','satellite'].includes(p.zone)));
    const sectors = Array<number>(8).fill(0);
    for (const p of occupied) {
      if (p.zone==='core' || !raw!.adjacency!.neighboursOf(p).some(n=>!occupied.has(n))) continue;
      const c = p.shape.centroid;
      sectors[Math.floor((Math.atan2(c.y,c.x)+Math.PI)/(2*Math.PI)*8)%8]++;
      expect(cityUrbanity(raw!,p)).toBeLessThan(.05);
      // Verify actual roofs too: irregular blocks must not bypass the taper.
      const roofArea = p.ward!.geometry.reduce((s,b)=>s+Math.abs(b.square),0);
      expect(roofArea/Math.abs(p.shape.square)).toBeLessThan(.25);
    }
    expect(sectors.every(n=>n>0)).toBe(true);
    expect(r.model.residents.insideWalls.assigned).toBe(10000);
    expect(r.model.residents.outsideWalls.assigned).toBe(190000);
    expect(r.model.residents.unassigned).toBe(0);
    expect(r.model.buildings.reduce((s,b)=>s+b.residents,0)).toBe(200000);
    expect(r.model.buildings.every(b=>b.residents<=b.capacity)).toBe(true);
    expect(Math.min(...r.model.buildings.map(b=>b.urbanity))).toBeLessThan(.1);
    expect(r.model.scene.layers.vegetation.length).toBeLessThan(100000);
    // An overview must not expand thousands of subpixel glyphs, but every
    // building must still be represented by its real footprint and identity.
    // Bound detail per building/parcel, allowing the physical amount of
    // housing and farmland to grow without relaxing the rendering constraint.
    const L = r.model.scene.layers;
    expect(Buffer.byteLength(r.svg)/(L.buildings.length+L.fields.length)).toBeLessThan(500);
    const drawn = new Set([...r.svg.matchAll(/data-building-id="([^"]+)"/g)].map(m=>m[1]));
    expect(r.model.scene.layers.buildings.every(b=>drawn.has(b.id!))).toBe(true);
    const districts = r.model.districts.filter(d=>d.urbanity>.05);
    const hull = convexHull(districts.flatMap(d=>d.boundary.map(p=>new Point(p.x,p.y))));
    expect(districts.reduce((s,d)=>s+area(d.boundary),0)/area(hull)).toBeGreaterThan(.8);
    const reach=Array<number>(24).fill(0);
    for(const d of districts)for(const p of d.boundary){
      const bin=Math.floor((Math.atan2(p.y,p.x)+Math.PI)/(2*Math.PI)*24)%24;
      reach[bin]=Math.max(reach[bin],Math.hypot(p.x,p.y));
    }
    // Connected does not mean circular; preserve road-led asymmetry.
    expect(Math.max(...reach)/Math.min(...reach)).toBeGreaterThan(1.25);
    const wells=L.symbols.filter(s=>s.id==='sm-well');
    expect(wells.length).toBeGreaterThan(0);
    for(const well of wells)expect(well.scale).toBeCloseTo(3.6);
    const temples=L.symbols.filter(s=>ARTWORK_MANIFEST[s.id]?.category==='faith');
    expect(temples).toHaveLength(1);
    expect(temples.every(s=>Math.max(s.scale,s.scaleY??s.scale)<=28)).toBe(true);
    const courts=L.symbols.filter(s=>ARTWORK_MANIFEST[s.id]?.courtyardVoids?.length && ARTWORK_MANIFEST[s.id]?.category!=='faith');
    expect(courts.every(s=>Math.min(s.scale,s.scaleY??s.scale)>=12.8)).toBe(true);
    const farmArea = L.fields.reduce((s,f)=>s+area(f.ring),0), bounds = r.model.scene.bounds;
    expect(farmArea/(200000*150)).toBeGreaterThan(.8);
    expect(farmArea/((bounds.max_x-bounds.min_x)*(bounds.max_y-bounds.min_y))).toBeGreaterThan(.4);
    const fieldColours = new Set([...r.svg.matchAll(/class="plot" style="fill:([^;]+);/g)].map(m=>m[1]));
    expect(fieldColours.size).toBeGreaterThanOrEqual(3);
    expect(fieldColours.has('var(--sm-landscape-temperate-soil, #b69c77)')).toBe(true);
    // The shared landscape must retain trees already placed inside city parks.
    const parks = L.greens.filter(g=>g.surface!=='paved').map(g=>g.ring.map(p=>new Point(p.x,p.y)));
    expect(L.vegetation.some(v=>parks.some(ring=>pointInPolygon(new Point(v.at.x,v.at.y),ring)))).toBe(true);
  }, 30000);

  it('restores artwork on zoom without changing the model or its full export', () => {
    const model = createSettlementModel(base, {seed:2,development:{preset:'city'}});
    const before = JSON.stringify(model), geo = exportSettlement(model);
    const bounds = {min_x:-60,min_y:-60,max_x:60,max_y:60};
    const overview = renderSettlement(model, {width:1});
    const closeup = renderSettlement(model, {bounds,width:900});
    const full = renderSettlement(model, {detail:'full'});
    expect(overview).toContain('id="canopy-overview"');
    expect(full).not.toContain('id="canopy-overview"');
    expect(overview.length).toBeLessThan(full.length);
    expect(closeup).toContain('viewBox="-60.0 -60.0 120.0 120.0"');
    expect(closeup).toContain('<use href="#glyph-');
    expect(JSON.stringify(model)).toBe(before);
    expect(exportSettlement(model)).toEqual(geo);
  });

  it('keeps roads crossing the viewport and rejects distant geometry', () => {
    const model = createSettlementModel(base, {seed:2,development:{preset:'city'}});
    const crossing = {kind:'road' as const,width:4,path:[{x:-100,y:0},{x:100,y:0}]};
    const outside = {...crossing,path:[{x:100,y:100},{x:200,y:100}]};
    const scene = {...model.scene,layers:{...model.scene.layers,roads:[crossing,outside]}};
    const result = sceneInView(scene,{min_x:-10,min_y:-10,max_x:10,max_y:10});
    expect(result.layers.roads).toEqual([crossing]);
    expect(result.layers.buildings.length).toBeLessThan(scene.layers.buildings.length);
    expect(scene.layers.roads).toHaveLength(2);
    expect(result.layers.water).toBe(scene.layers.water);
    expect(result.layers.walls).toBe(scene.layers.walls);
  });

  it.each([0,-1,NaN,Infinity])('rejects invalid display width %s', width => {
    // Validation runs before any scene access or SVG assembly.
    expect(()=>renderSettlement({} as never,{width})).toThrow('render width');
  });
  it('rejects an invalid viewport', () => {
    expect(()=>renderSettlement({} as never,{bounds:{min_x:0,max_x:0,min_y:0,max_y:10}})).toThrow('render bounds');
    expect(()=>renderSettlement({} as never,{bounds:{min_x:0,max_x:Infinity,min_y:0,max_y:10}})).toThrow('render bounds');
  });

  it('reports a shortage instead of exceeding capacities or moving a wall allocation', () => {
    const buildings: SettlementBuilding[] = [true,false].map((insideWalls,i)=>({id:String(i),districtId:String(i),footprint:[],urbanity:insideWalls?1:0,insideWalls,capacity:4,residents:0}));
    const r=allocateResidents(buildings,10,8);
    expect(r.insideWalls).toEqual({requested:8,capacity:4,assigned:4,unassigned:4});
    expect(r.outsideWalls.assigned).toBe(2);
    expect(r.unassigned).toBe(4);
    expect(buildings.map(b=>b.capacity)).toEqual([4,4]);
  });

  it.each([-1,801,NaN,2.5])('rejects invalid core population %s', corePopulation => {
    expect(()=>resolveDevelopment(800,true,{preset:'city',corePopulation})).toThrow(RangeError);
  });
  it('requires walls for an enclosure target', () => {
    expect(()=>resolveDevelopment(800,false,{preset:'city',corePopulation:600})).toThrow('requires walls');
  });
  it('uses the requested village occupancy and rejects an unsupported gradient', () => {
    expect(resolveDevelopment(800,false,{preset:'village',edgeOccupancy:8})).toMatchObject({centreOccupancy:8,edgeOccupancy:8});
    expect(()=>resolveDevelopment(800,false,{preset:'village',centreOccupancy:16})).toThrow('use the city preset');
  });
  it.each(['village','city'] as const)('keeps supplied water in metre coordinates for %s', preset => {
    const water = [[{x:500,y:-1000},{x:1000,y:-1000},{x:1000,y:1000},{x:500,y:1000}]];
    const r = planSettlement({...base,coastlineGeometry:water}, {seed:2,development:{preset}});
    const f=r.geojson.features.find(f=>f.id==='water')!;
    expect(f.geometry.type).toBe('MultiPolygon');
    if(f.geometry.type==='MultiPolygon')expect(Math.min(...f.geometry.coordinates.flat(2).map(p=>p[0]))).toBe(500);
  });
});
