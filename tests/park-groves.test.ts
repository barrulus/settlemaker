import {describe,expect,it,vi} from 'vitest';
import {createCityModel,createSettlementModel,parseSettlementUrl} from '../src/index.js';
import {ARTWORK_MANIFEST,ARTWORK_INK,cityGlyph} from '../src/assets/artwork.js';
import {floraCanopyRadius,selectParkTreeAt} from '../src/assets/landscape-placement.js';
import {cityMetersPerUnit} from '../src/generator/city-glyphs.js';
import {cityRoadReservations} from '../src/generator/city-streets.js';
import {nearestOnSegment} from '../src/generator/city-frontage.js';
import {Model} from '../src/generator/model.js';
import {artworkPaintRadius} from '../src/assets/artwork-bounds.js';
import {wallPaintWidth,wallTowerCanvas,WALL_GATE_CLEARANCE} from '../src/assets/fortification-dimensions.js';
import {plantCityParks} from '../src/generator/park-planting.js';
import {Polygon} from '../src/geom/polygon.js';
import {pointInPolygon} from '../src/geom/point-in-polygon.js';
import {Park} from '../src/wards/park.js';
import {Point} from '../src/types/point.js';
import {WardType} from '../src/types/interfaces.js';
import {resolveGlyphFor} from '../src/village/deck.js';

const capital='name=Aldford&pop=5000&seed=271401&walls=1&plaza=1&temple=1&capital=1&shanty=1&theme=ancient&roads=330:main,117:market,192:footpath,278:main&biome=desert';
const temperate='name=Aldford&pop=1200&seed=353956&walls=1&plaza=1&roads=316:local,146:local,282:footpath';
async function legacy(query:string){const p=await parseSettlementUrl(new URLSearchParams(query));return createCityModel(p.burg,{seed:p.seedOverride}).model;}

describe('managed park groves',()=>{
  it.each(['temperate','desert','tundra','tropical','coastal'])('selects actual living canopy trees for planted %s parks',biome=>{
    for(let i=0;i<50;i++){
      const id=selectParkTreeAt(biome,i*13,i*7,42,i/50);
      expect(ARTWORK_MANIFEST[id]?.layer).toBe('tree');
      expect(id).not.toMatch(/snag|deadwood|scrub|grass/);
      const box=ARTWORK_INK[id].bounds,r=floraCanopyRadius(id,7);
      for(const [x,y]of[[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]]])
        expect(Math.hypot(x-32,y-32)*7/64).toBeLessThanOrEqual(r+1e-8);
    }
  });

  it.each([['desert capital',capital,556],['temperate town',temperate,203]] as const)('plants shaded, walkable %s without changing houses or census',async(_name,query,budget)=>{
    const model=await legacy(query),k=cityMetersPerUnit(model);
    const parks=model.patches.map(p=>p.ward).filter((w):w is Park=>w instanceof Park);
    const roads=cityRoadReservations(model);
    const buildings=model.patches.filter(p=>p.ward?.type!==WardType.Park).flatMap(p=>p.ward?.geometry??[]);
    expect(parks.length).toBeGreaterThan(0);
    expect(model.getBuildingCapacity()).toMatchObject({target:budget,placed:budget,shortfall:0});
    for(const park of parks){
      expect(park.trees.length).toBeGreaterThan(15);
      const land=park.geometry.reduce((n,p)=>n+Math.abs(p.square),0);
      const painted=park.trees.reduce((n,t)=>n+ARTWORK_INK[t.kind].area*t.scale*t.scale/4096,0);
      // This sums painted areas, not exact union shade. It catches the former
      // few dots/scrub plants while preserving open walks and the central lawn.
      expect(painted/land).toBeGreaterThan(.18);
      for(const tree of park.trees){
        const radius=Math.max(tree.scale/2,floraCanopyRadius(tree.kind,tree.scale));
        const nominal=ARTWORK_MANIFEST[tree.kind].footprint![0];
        expect(tree.scale*k/nominal).toBeGreaterThanOrEqual(.9-1e-8);
        expect(tree.scale*k/nominal).toBeLessThanOrEqual(1.1+1e-8);
        expect(park.geometry.some(g=>pointInPolygon(tree.at,g.vertices)&&g.vertices.every((a,i)=>
          Point.distance(tree.at,nearestOnSegment(tree.at,a,g.vertices[(i+1)%g.length]))>=radius+.5/k-1e-8))).toBe(true);
        for(const path of park.paths)for(let i=1;i<path.length;i++)expect(Point.distance(tree.at,nearestOnSegment(tree.at,path[i-1],path[i])))
          .toBeGreaterThanOrEqual(radius+park.pathWidth/2+.5/k-1e-8);
        if(model.wall){
          const wall=model.wall;
          for(const at of wall.towers){
            if(wall.gates.some(g=>Point.distance(g,at)<WALL_GATE_CLEARANCE))continue;
            const towerRadius=artworkPaintRadius(cityGlyph('castle-tower-round',model.params.biome),wallTowerCanvas(false));
            expect(Point.distance(tree.at,at)).toBeGreaterThanOrEqual(radius+towerRadius+.5/k-1e-8);
          }
          for(const [i,a]of wall.shape.vertices.entries())if(wall.segments[i])expect(Point.distance(tree.at,nearestOnSegment(tree.at,a,wall.shape.vertices[(i+1)%wall.shape.length])))
            .toBeGreaterThanOrEqual(radius+wallPaintWidth(false)/2+.5/k-1e-8);
        }
        for(const symbol of model.symbols.filter(s=>s.zBand==='structure'&&!s.building))expect(Point.distance(tree.at,symbol.at))
          .toBeGreaterThanOrEqual(radius+artworkPaintRadius(resolveGlyphFor(model.params.biome,symbol.id),symbol.scale,symbol.scaleY??symbol.scale)+.5/k-1e-8);
        for(const polygon of [...roads.map(r=>r.polygon),...buildings]){
          expect(pointInPolygon(tree.at,polygon.vertices)).toBe(false);
          const nearest=Math.min(...polygon.vertices.map((a,i)=>Point.distance(tree.at,nearestOnSegment(tree.at,a,polygon.vertices[(i+1)%polygon.length]))));
          expect(nearest).toBeGreaterThanOrEqual(radius+.5/k-1e-8);
        }
      }
    }
    const before=JSON.stringify({geometry:model.patches.map(p=>p.ward?.geometry),paths:parks.map(p=>p.paths),census:model.getBuildingCapacity(),trees:parks.map(p=>p.trees)});
    const random=model.rng.getSeed();
    plantCityParks(model,k);
    expect(model.rng.getSeed()).toBe(random);
    expect(JSON.stringify({geometry:model.patches.map(p=>p.ward?.geometry),paths:parks.map(p=>p.paths),census:model.getBuildingCapacity(),trees:parks.map(p=>p.trees)})).toBe(before);
    const originalTree=parks[0].trees[0];
    const pond=Polygon.rect(10/k,10/k).vertices.map(p=>p.add(originalTree.at));
    const water=vi.spyOn(model,'getWaterRings').mockReturnValue([pond]);
    try{
      plantCityParks(model,k);
      expect(parks.flatMap(p=>p.trees).length).toBeGreaterThan(0);
      for(const tree of parks.flatMap(p=>p.trees)){
        expect(pointInPolygon(tree.at,pond)).toBe(false);
        const radius=Math.max(tree.scale/2,floraCanopyRadius(tree.kind,tree.scale));
        for(const [i,a]of pond.entries())expect(Point.distance(tree.at,nearestOnSegment(tree.at,a,pond[(i+1)%pond.length])))
          .toBeGreaterThanOrEqual(radius+.5/k-1e-8);
      }
    }finally{water.mockRestore();}
  });

  it('uses the same authored metre scale in physical parks and keeps residents conserved',()=>{
    let raw:Model|undefined;
    const generate=Model.prototype.generate;
    const capture=vi.spyOn(Model.prototype,'generate').mockImplementation(function(this:Model){raw=generate.call(this);return raw;});
    let model;
    try{model=createSettlementModel({name:'Park',population:10000,walls:true,plaza:true,temple:true,roadBearings:[20,145,270]},
      {seed:2,development:{preset:'city',corePopulation:5000,ruralPopulation:1000}});}finally{capture.mockRestore();}
    expect(model.residents).toMatchObject({assigned:10000,unassigned:0,insideWalls:{assigned:5000},rural:{assigned:1000}});
    const parks=raw!.patches.map(p=>p.ward).filter((w):w is Park=>w instanceof Park);
    expect(parks.flatMap(p=>p.trees).length).toBeGreaterThan(20);
    for(const tree of parks.flatMap(p=>p.trees)){
      expect(ARTWORK_MANIFEST[tree.kind].layer).toBe('tree');
      expect(tree.scale*3/ARTWORK_MANIFEST[tree.kind].footprint![0]).toBeGreaterThanOrEqual(.9-1e-8);
      expect(tree.scale*3/ARTWORK_MANIFEST[tree.kind].footprint![0]).toBeLessThanOrEqual(1.1+1e-8);
      expect(model.scene.layers.vegetation.some(t=>t.kind===tree.kind&&Math.abs(t.scale-tree.scale*3)<1e-8)).toBe(true);
    }
  });
});
