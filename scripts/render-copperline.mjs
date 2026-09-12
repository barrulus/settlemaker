/** Run after npm run build: node scripts/render-copperline.mjs */
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createSkin, generateSettlement, SKIN_SLOTS, skinBiomeFor } from '../dist/index.js';

const root = new URL('../', import.meta.url);
const definition = JSON.parse(readFileSync(new URL('docs/examples/copperline.skin.json', root), 'utf8'));
const skin = createSkin(definition);
assert.deepEqual(Object.keys(definition.glyphs).sort(), Object.keys(SKIN_SLOTS).sort());
for (const [id,slot] of Object.entries(SKIN_SLOTS)) {
  assert.equal(Boolean(definition.glyphs[id].sil), slot.zBand === 'structure', `Shadow contract: ${id}`);
}
const burg = {
  name: 'Copperline', population: 400, biome: 'industrial', port: false, citadel: false,
  walls: false, plaza: true, temple: true, shanty: false, capital: false,
  roadBearings: [0, 120, 240],
};
for (const biome of Object.keys(definition.biomes)) {
  assert.equal(skinBiomeFor(skin, biome).base, 'temperate');
  for (const population of [400, 2500]) {
    const result = generateSettlement({ ...burg, biome, population }, { seed: 42, skin });
    assert.equal(result.kind, population === 400 ? 'village' : 'settlement');
    const label = population === 400 ? 'village' : 'city';
    const ids = [...result.svg.matchAll(/<(?:g|symbol) id="(?:glyph-)?(sm-[^"]+)"/g)]
      .map(m=>m[1]).filter(id => !id.endsWith('-sil'));
    assert.ok(ids.length > 0, 'Map must contain artwork');
    for (const id of ids) {
      assert.ok(definition.glyphs[id], `Missing replacement: ${id}`);
    }
    assert.ok(result.svg.includes('var(--cl-'), 'Map must use Copperline materials');
    if (biome === 'industrial') {
      writeFileSync(new URL(`docs/examples/copperline-${label}.svg`, root), result.svg);
    }
    console.log(`${biome}: ${label}, ${ids.length} artwork definitions; valid`);
  }
}
