import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {generateSettlement,buildScene,Point} from '../src/index.js';
import {selectFloraAt} from '../src/assets/landscape-placement.js';
import {ARTWORK_GLYPHS,ARTWORK_MANIFEST,BIOMES} from '../src/assets/artwork.js';
import {greenGround} from '../src/assets/greens-art.js';
import {farmDetails} from '../src/output/artwork.js';
import {cityUrbanity} from '../src/generator/city-character.js';
import {CommonWard} from '../src/wards/common-ward.js';
import {Park} from '../src/wards/park.js';
import {villageWallBoundary} from '../src/village/walls.js';
import {inkExtent} from '../src/village/glyphs.js';
import {pointInPolygon} from '../src/geom/point-in-polygon.js';
import {nearestOnSegment} from '../src/generator/city-frontage.js';
import {roadFixture} from './fixtures/village-roads.js';

describe('biome landscape character',()=>{
  it.each(BIOMES)('%s has a distinct green surface and valid coherent plant stands',biome=>{
    const art=greenGround('M0,0H64V64H0Z',biome);
    expect(art).toContain(`--sm-green-${biome}-turf`);
    expect(art).not.toContain('--sm-ink');
    const id=`sm-green-round-a--${biome}`;
    const saved=readFileSync(`symbols/greens/individual/${id}.svg`,'utf8').replace(/^.*?<svg[^>]*>/s,'').replace(/<\/svg>\s*$/,'');
    expect(ARTWORK_GLYPHS[id].body).toBe(saved);
    let near=0,far=0;
    const species=(x:number,y:number)=>{
      const id=selectFloraAt(biome,x,y,71,.3);
      expect(ARTWORK_MANIFEST[id]?.biome,id).toBe(biome);
      return ARTWORK_MANIFEST[id].family;
    };
    for(let x=-200;x<200;x+=10)for(let y=-200;y<200;y+=10){
      const here=species(x,y);
      if(here===species(x+3,y))near++;
      if(here===species(x+123,y+99))far++;
    }
    expect(near).toBeGreaterThan(far*1.35);
  });

  it('uses broad unoutlined crown highlights instead of dark nested rings',()=>{
    for(const id of ['sm-flora-oak-a--temperate','sm-flora-beech-a--temperate','sm-flora-rainforest-canopy-a--tropical']){
      const body=ARTWORK_GLYPHS[id].body;
      expect(body.match(/stroke-width="0"/g)?.length).toBeGreaterThan(5);
      expect(body).not.toContain('stroke-width="1.5"');
    }
  });

  it('reserves wells and perimeter irrigation channels for desert plots',()=>{
    const ring=[{x:0,y:0},{x:40,y:0},{x:38,y:30},{x:0,y:30}];
    expect(farmDetails(ring,'sm-field-irrigated-grain--desert',1,'d')).toContain('data-irrigation-source="well"');
    const paddy=farmDetails(ring,'sm-field-wet-rice-paddy--tropical',1,'p');
    expect(paddy).not.toContain('irrigation-source');
    expect(paddy).not.toContain('-water');
    expect(paddy).toContain('M0,10H40');
    expect(paddy).toContain('M0,20H40');
    expect(ARTWORK_GLYPHS['sm-field-wet-rice-paddy--tropical'].body).toContain('--sm-landscape-tropical-paddy');
  });

  it('does not irrigate tropical paddies from an ocean, but permits them with a river',()=>{
    const base=roadFixture(150,{biome:'tropical',coastlineGeometry:[[{x:100,y:-500},{x:500,y:-500},{x:500,y:500},{x:100,y:500}]]});
    const sea=generateSettlement(base,{seed:2});
    const river=generateSettlement({...base,rivers:[{centreline:[{x:-500,y:90},{x:500,y:90}],widthM:6,meander:false}]},{seed:2});
    if(sea.kind!=='village'||river.kind!=='village')throw Error('expected villages');
    expect(sea.model.fields.length).toBeGreaterThan(0);
    expect(sea.svg).not.toContain('data-field-glyph="sm-field-wet-rice-paddy');
    expect(river.svg).toContain('sm-field-wet-rice-paddy');
    expect(river.svg).not.toContain('data-irrigation-source="well"');
  });

  it('fits village walls to occupied roofs with a small walkable clearance',()=>{
    const r=generateSettlement(roadFixture(150,{walls:true,temple:false}),{seed:2});
    if(r.kind!=='village')throw Error('expected village');
    const boundary=villageWallBoundary(r.model.buildings,r.model.pois,[]);
    const distances:number[]=[];
    for(const b of r.model.buildings){
      const e=inkExtent(b.glyph,b.footprint),a=b.bearingDeg*Math.PI/180;
      for(const x of [-e.width/2,e.width/2])for(const y of [-e.depth/2,e.depth/2]){
        const p=new Point(b.position.x+x*Math.cos(a)-y*Math.sin(a),b.position.y+y*Math.cos(a)+x*Math.sin(a));
        expect(pointInPolygon(p,boundary)).toBe(true);
        distances.push(Math.min(...boundary.map((v,i)=>Point.distance(p,nearestOnSegment(p,v,boundary[(i+1)%boundary.length])))));
      }
    }
    expect(Math.min(...distances)).toBeCloseTo(3.5,4);
    expect(r.model.wall?.gates.length).toBeGreaterThanOrEqual(2);
  });

  it('packs city centres and opens the outskirts into gardens and varied rural homes',()=>{
    const r=generateSettlement(roadFixture(50000,{walls:true,temple:true}),{seed:2});
    if(r.kind!=='settlement')throw Error('expected city');
    const coverage=(inner:boolean)=>{
      const patches=r.model.patches.filter(p=>p.withinCity&&p.ward instanceof CommonWard&&(inner?cityUrbanity(r.model,p)>.7:cityUrbanity(r.model,p)<.3));
      expect(patches.length).toBeGreaterThan(0);
      return patches.reduce((n,p)=>n+p.ward!.geometry.reduce((s,b)=>s+Math.abs(b.square),0),0)/patches.reduce((n,p)=>n+Math.abs(p.shape.square),0);
    };
    expect(coverage(true)).toBeGreaterThan(coverage(false)*1.6);
    expect(r.model.patches.filter(p=>p.ward instanceof Park).length).toBeGreaterThan(1);
    expect(buildScene(r.model).layers.greens.length).toBeGreaterThan(30);
    expect(r.geojson.features.filter(f=>f.properties?.kind==='garden').length).toBe(r.model.patches.reduce((n,p)=>n+(p.ward instanceof CommonWard?p.ward.gardens.length:0),0));
    expect(r.model.symbols.filter(s=>s.id.startsWith('sm-house')).length).toBeGreaterThan(10);
    expect(new Set(r.model.symbols.map(s=>s.materialVariant??0)).size).toBe(5);
    expect(r.svg).toContain('roof-tone-4');
  });
});
