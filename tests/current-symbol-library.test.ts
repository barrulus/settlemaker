import {describe,it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {ARTWORK_GLYPHS,ARTWORK_MANIFEST} from '../src/assets/artwork.js';

const collections=['village','city','infrastructure','landscape','greens','markers'];
describe('current downloadable symbol library',()=>{
  it('retires both old source collections',()=>{
    expect(existsSync('symbols/batch001')).toBe(false);
    expect(existsSync('symbols/refined')).toBe(false);
  });
  it.each(collections)('%s exposes an independent SVG for every declared drawing and shadow',collection=>{
    const marker=collection==='markers';
    const manifest=JSON.parse(readFileSync(`symbols/${collection}/${marker?'markers':'symbols'}.json`,'utf8'));
    const symbols=marker?manifest.markers:manifest.symbols;
    expect(Object.keys(symbols).length).toBeGreaterThan(0);
    for(const [id,meta] of Object.entries(symbols) as [string,{silhouette?:string,viewBox:number[]}][]){
      const directory=`symbols/${collection}/${marker?'':'individual/'}`;
      for(const key of [id,...(meta.silhouette?[meta.silhouette]:[])]){
        const svg=readFileSync(`${directory}${key}.svg`,'utf8');
        expect(svg,key).toContain('<svg');
        expect(svg,key).toContain(`viewBox="${meta.viewBox.join(' ')}"`);
        expect(svg,key).not.toMatch(/<image\b|(?:href|src)="https?:|symbols\/(?:refined|batch001)/);
      }
    }
  });
  it('keeps every rural building placement contract without retired sprite inputs',()=>{
    const source=JSON.parse(readFileSync('scripts/art/village-footprints.json','utf8')).symbols;
    const village=JSON.parse(readFileSync('symbols/village/symbols.json','utf8')).symbols;
    expect(Object.keys(source)).toEqual(Object.keys(village));
    for(const [id,m] of Object.entries(source) as [string,{footprint:number[],anchor:number[]}][]){
      expect(ARTWORK_MANIFEST[id].footprint,id).toEqual(m.footprint);
      expect(ARTWORK_MANIFEST[id].anchor,id).toEqual(m.anchor);
      expect(ARTWORK_GLYPHS[id].body,id).toBeTruthy();
    }
    const gallery=readFileSync('symbols/village/index.html','utf8');
    expect(gallery).not.toContain('Compare original');
    expect(gallery).not.toContain('data.old');
  });
});
