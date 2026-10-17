import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { generateSettlement, createSettlementSession, type AzgaarBurgInput } from './src/index.js';

const burg = (name: string, population: number, flags: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput => ({
  name, population, port: false, citadel: false, walls: false, plaza: false,
  temple: false, shanty: false, capital: false, ...flags,
});

for (const population of [50, 500, 3000, 15000, 80000]) {
  const result = generateSettlement(burg(`Population ${population}`, population), { seed: 42 });
  assert.equal(result.kind, 'planned');
  assert.equal(result.geojson.metadata.schema, 'settlemaker/physical-plan');
  assert.equal(result.geojson.metadata.coordinate_units, 'metres');
  assert.equal(result.model.residents.requested, population);
  assert.equal(result.model.residents.assigned + result.model.residents.unassigned, population);
  console.log(`Population ${population}: ${result.model.development.preset}, ${result.model.buildings.length} buildings, ${result.model.residents.assigned} residents assigned`);
}

const input = burg('Thornwall', 5000, { citadel: true, walls: true, plaza: true, temple: true });
const first = generateSettlement(input, { seed: 12345 });
const again = generateSettlement(input, { seed: 12345 });
assert.equal(first.svg, again.svg);
assert.deepEqual(first.geojson, again.geojson);
assert.notEqual(first.svg, generateSettlement(input, { seed: 99999 }).svg);
const session = createSettlementSession(input, { seed: 12345 });
assert.deepEqual(session.exportGeoJson(), first.geojson);
writeFileSync('test-output.svg', first.svg);
writeFileSync('test-output.geojson', JSON.stringify(first.geojson, null, 2));
console.log('Determinism and retained physical exports passed');

const port = generateSettlement(burg('Seahaven', 10000, {
  port: true, walls: true, plaza: true, temple: true, oceanBearing: 90, harbourSize: 'large',
}), { seed: 42 });
writeFileSync('test-output-port.svg', port.svg);
console.log(`Port: ${port.model.scene.layers.water.rings.length} water rings, ${port.model.scene.layers.piers.length} piers`);
