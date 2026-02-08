import { generateFromBurg, type AzgaarBurgInput } from './src/index.js';
import { writeFileSync } from 'fs';

function test(name: string, pop: number, flags: Partial<AzgaarBurgInput> = {}) {
  const burg: AzgaarBurgInput = {
    name, population: pop,
    port: false, citadel: false, walls: false, plaza: false,
    temple: false, shanty: false, capital: false,
    ...flags,
  };

  const result = generateFromBurg(burg, { seed: 42 });
  const wards = new Map<string, number>();
  for (const p of result.model.patches) {
    if (p.ward) {
      const l = p.ward.getLabel() ?? 'Empty';
      wards.set(l, (wards.get(l) ?? 0) + 1);
    }
  }

  console.log(`${name} (pop=${pop}, patches=${result.model.patches.length}, inner=${result.model.inner.length}, gates=${result.model.gates.length})`);
  console.log(`  ${[...wards.entries()].map(([k, v]) => `${k}:${v}`).join(', ')}`);
  return result;
}

console.log('=== Size Variations ===');
test('Hamlet', 50);
test('Village', 500, { walls: true, plaza: true });
test('Town', 3000, { walls: true, plaza: true, citadel: true, temple: true });
test('City', 15000, { walls: true, plaza: true, citadel: true, temple: true, capital: true });
test('Metropolis', 80000, { walls: true, plaza: true, citadel: true, temple: true, capital: true, shanty: true });

console.log('\n=== Determinism Check ===');
const r1 = generateFromBurg({ name: 'Test', population: 5000, port: false, citadel: true, walls: true, plaza: true, temple: true, shanty: false, capital: false }, { seed: 12345 });
const r2 = generateFromBurg({ name: 'Test', population: 5000, port: false, citadel: true, walls: true, plaza: true, temple: true, shanty: false, capital: false }, { seed: 12345 });
console.log('Same seed same SVG:', r1.svg === r2.svg ? 'PASS' : 'FAIL');
console.log('Same seed same GeoJSON count:', r1.geojson.features.length === r2.geojson.features.length ? 'PASS' : 'FAIL');

const r3 = generateFromBurg({ name: 'Test', population: 5000, port: false, citadel: true, walls: true, plaza: true, temple: true, shanty: false, capital: false }, { seed: 99999 });
console.log('Different seed different SVG:', r1.svg !== r3.svg ? 'PASS' : 'FAIL');

// Write full-featured city SVG
const city = generateFromBurg({
  name: 'Thornwall', population: 15000,
  port: false, citadel: true, walls: true, plaza: true,
  temple: true, shanty: false, capital: true,
}, { seed: 42 });
writeFileSync('test-output.svg', city.svg);
console.log(`\nSVG written: ${city.svg.length} chars`);
