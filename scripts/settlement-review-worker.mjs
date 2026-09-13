import { renderSettlement } from '../src/settlement/output.ts';
import { PALETTES } from '../src/output/palette.ts';
const cache=new Map();
self.onmessage=({data})=>{
  const {id,key,scene,bounds,width,theme}=data;
  try{
    const saved=scene??cache.get(key);if(!saved)throw Error('Map model is not loaded');
    cache.delete(key);cache.set(key,saved);while(cache.size>3)cache.delete(cache.keys().next().value);
    const start=performance.now();
    const svg=renderSettlement({scene:saved},{bounds,width,palette:theme==='natural'?undefined:PALETTES[theme]});
    self.postMessage({id,blob:new Blob([svg],{type:'image/svg+xml'}),ms:performance.now()-start});
  }catch(error){self.postMessage({id,error:error.message});}
};
