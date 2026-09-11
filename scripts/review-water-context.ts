import type { AzgaarBurgInput, WaterContextV1, WaterContextResult } from '../src/index.js';
import { generateSettlement } from '../src/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const out='output/water-context-review';mkdirSync(out,{recursive:true});
const summaries: Array<{mode: string; pop: number; seed: number; status?: WaterContextResult; housed?: number; error?: string}> = [];
for(const pop of [10,94,300,1000])for(const seed of [1,2,3])for(const mode of ['dry','coast','island','lake','river']) {
const box=(x:number,y:number,X:number,Y:number)=>[{x,y},{x:X,y},{x:X,y:Y},{x,y:Y}];
const waterContext: Extract<WaterContextV1, {status: 'measured'}>={version:1,status:'measured',coordinateSpace:'burg-local-metres',surveyRadiusM:3000,geometryErrorM:.5,bodies:[]};
const input: AzgaarBurgInput={name:mode,population:pop,port:false,citadel:false,walls:false,plaza:false,temple:false,shanty:false,capital:false,waterContext,
roadBearings:[{bearing_deg:25,kind:'main'},{bearing_deg:143,kind:'local'},{bearing_deg:265,kind:'trail'}]};
if(mode==='coast'){input.coastlineGeometry=[box(60,-3000,3000,3000)];waterContext.bodies=[{kind:'ocean',distanceM:60,bearingDeg:90,polygonIndices:[0]}];}
if(mode==='island'){input.coastlineGeometry=[box(-3000,-3000,3000,-180),box(-3000,180,3000,3000),box(-3000,-180,-180,180),box(180,-180,3000,180)];waterContext.bodies=[{kind:'ocean',distanceM:180,bearingDeg:0,polygonIndices:[0,1,2,3]}];}
if(mode==='lake'){input.coastlineGeometry=[box(65,-80,170,80)];waterContext.bodies=[{kind:'lake',distanceM:65,bearingDeg:90,polygonIndices:[0]}];}
if(mode==='river')input.rivers=[{centreline:[{x:-3000,y:70},{x:0,y:70},{x:3000,y:70}],widthM:8,meander:false}];
try{const r=generateSettlement(input,{seed});if(r.kind!=='village')throw Error('engine');summaries.push({mode,pop,seed,status:r.waterContextResult,housed:r.model.buildings.reduce((s,b)=>s+b.occupancy,0)});if(seed===2)writeFileSync(`${out}/${mode}-${pop}.svg`,r.svg);}
catch(e){summaries.push({mode,pop,seed,error:String(e)});}
}
writeFileSync(`${out}/matrix.json`,JSON.stringify(summaries,null,2));console.log(JSON.stringify({cases:summaries.length,errors:summaries.filter(x=>x.error),warnings:summaries.filter(x=>x.status?.issues.length)},null,2));

if (summaries.some(row => row.error)) process.exitCode = 1;
