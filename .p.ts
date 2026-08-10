import { generateFromBurg, WardType } from './src/index.js';
import { CommonWard } from './src/wards/common-ward.js';
const aldford = (population:number):any => ({ name:'Aldford', population, port:false, citadel:false, walls:true, plaza:true, temple:true, shanty:false, capital:false });
for (const pop of [300,600,1200,4000,10000,20000,70000]) {
  let sum=0, n=0;
  for (let seed=1; seed<=5; seed++) {
    const { model } = generateFromBurg(aldford(pop), { seed });
    for (const p of model.patches as any[]) {
      if (!(p.ward instanceof CommonWard)) continue;
      if (!p.withinWalls) continue;
      for (const b of p.ward.geometry) { sum += Math.abs(b.square); n++; }
    }
  }
  console.log('pop', pop, 'mean', (sum/n).toFixed(2), 'n', n);
}
