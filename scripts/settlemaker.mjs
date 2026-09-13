#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { planSettlement } from '../dist/index.js';
try {
const { values } = parseArgs({ options: {
  population: { type:'string', default:'800' }, 'is-city': { type:'boolean', default:false },
  'core-population': { type:'string' }, walls: { type:'boolean', default:false },
  seed: { type:'string', default:'2' }, biome: { type:'string', default:'temperate' }, theme: { type:'string' },
  name: { type:'string', default:'Settlement' }, out: { type:'string', default:'output/settlement' }, help: { type:'boolean' },
} });
if (values.help) {
  console.log('settlemaker --population 200000 --is-city --walls --core-population 10000 --out output/capital\n\nOmit --is-city for dispersed village development. Writes settlement.svg, settlement.geojson and residents.json into --out. All geometry uses local metres.');
} else {
    const result=planSettlement({ name:values.name,population:Number(values.population),biome:values.biome,
      walls:values.walls,port:false,citadel:false,plaza:true,temple:true,shanty:false,capital:false,roadBearings:[20,145,270] },
    { seed:Number(values.seed),theme:values.theme,development:{preset:values['is-city']?'city':'village',
      ...(values['core-population']!==undefined?{corePopulation:Number(values['core-population'])}:{})} });
    const out=resolve(values.out);await mkdir(out,{recursive:true});
    await writeFile(resolve(out,'settlement.svg'),result.svg);
    await writeFile(resolve(out,'settlement.geojson'),JSON.stringify(result.geojson));
    await writeFile(resolve(out,'residents.json'),JSON.stringify({residents:result.model.residents,diagnostics:result.model.diagnostics},null,2));
    console.log(`${result.model.residents.assigned.toLocaleString('en-GB')} residents assigned; ${result.model.residents.unassigned.toLocaleString('en-GB')} unassigned.\n${out}`);
    if(result.model.residents.unassigned)process.exitCode=2;
}
} catch(error){console.error(error.message);process.exitCode=1;}
