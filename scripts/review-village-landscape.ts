import { mkdirSync, writeFileSync } from 'node:fs';
import { generateSettlement } from '../src/index.js';
import { roadFixture, roadReviewFixtures } from '../tests/fixtures/village-roads.js';

// Synthetic comparisons inspired by the reference landscapes, not reconstructions
// of their unavailable FMG inputs. Re-run with the same inputs and seeds.
const out = 'output/landscape-review';
mkdirSync(out, { recursive: true });
const fixtures = [
  { id: 'hamlet', seed: 3, input: roadFixture(23) },
  { id: 'temperate', seed: 2, input: roadFixture(190) },
  { id: 'tundra', seed: 2, input: roadFixture(94, { biome: 'tundra' }) },
  { id: 'desert', seed: 3, input: roadFixture(130, { biome: 'desert' }) },
  ...roadReviewFixtures.filter(f => ['headland', 'estuary', 'brook'].includes(f.id)),
];
const cards: string[] = [];
for (const fixture of fixtures) {
  for (const temple of [false, true]) {
    const id = `${fixture.id}-${temple ? 'temple' : 'ordinary'}`;
    const input = { ...fixture.input, temple };
    const start = performance.now();
    const result = generateSettlement(input, { seed: fixture.seed });
    if (result.kind !== 'village') continue;
    const m = result.model;
    const stats = { id, input, seed: fixture.seed, runtimeMs: Math.round(performance.now() - start), trees: m.vegetation.length,
      henges: m.pois.filter(p => p.kind === 'stone-circle').length, diagnostics: m.diagnostics };
    console.log(JSON.stringify(stats));
    writeFileSync(`${out}/${id}.svg`, result.svg);
    writeFileSync(`${out}/${id}.json`, JSON.stringify({ ...stats, model: m }));
    cards.push(`<article><h2>${id} · pop ${input.population} · seed ${fixture.seed}</h2><p>${stats.trees} flora glyphs · ${stats.henges} henges</p><a href="${id}.svg"><img src="${id}.svg" /></a></article>`);
  }
}
writeFileSync(`${out}/index.html`, `<!doctype html><meta charset="utf-8"><title>Village henges and flora</title><style>body{font:16px system-ui;background:#eee;margin:20px}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:white;padding:12px}img{width:100%}h2{font-size:18px}</style><h1>Village henges and flora</h1><main>${cards.join('')}</main>`);
