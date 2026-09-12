/** Generate the public documentation gallery from the compiled package API. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createSkin, encodeBurgParam, generateSettlement, PALETTES, SETTLEMAKER_VERSION } from '../dist/index.js';

const root = new URL('../', import.meta.url);
const out = new URL('docs/examples/gallery/', root);
mkdirSync(out, { recursive: true });
const flags = { port: false, citadel: false, walls: false, plaza: true, temple: true, shanty: false, capital: false };
const roads = [
  { bearing_deg: 18, kind: 'main', route_id: 'north-road' },
  { bearing_deg: 142, kind: 'town', route_id: 'south-road' },
  { bearing_deg: 267, kind: 'local', route_id: 'west-road' },
];
const fixtures = [
  { id: 'temperate-village', title: 'Ashford — temperate village', description: 'Roads, individual homes, a green and cultivated fields.', burg: { name: 'Ashford', population: 300, biome: 'temperate' } },
  { id: 'temperate-city', title: 'Thornwall — walled city', description: 'Native city buildings, denser central wards, greener outskirts and defensive walls.', burg: { name: 'Thornwall', population: 10000, biome: 'temperate', walls: true, citadel: true, capital: true } },
  { id: 'desert-village', title: 'Qasra — desert village', description: 'Desert buildings, sparse vegetation and irrigated field textures.', burg: { name: 'Qasra', population: 300, biome: 'desert' } },
  { id: 'desert-city', title: 'Qasr — desert city', description: 'Urban desert architecture, religious buildings and courtyards.', burg: { name: 'Qasr', population: 10000, biome: 'desert', walls: true, citadel: true } },
  { id: 'tundra-village', title: 'Snowmere — tundra village', description: 'Snowy dwellings and low tundra vegetation with natural ground instead of arable fields.', burg: { name: 'Snowmere', population: 300, biome: 'tundra' } },
  { id: 'tundra-city', title: 'Frosthold — tundra city', description: 'Northern roofs, fortifications and biome-specific ground.', burg: { name: 'Frosthold', population: 10000, biome: 'tundra', walls: true, citadel: true } },
  { id: 'tropical-village', title: 'Reedbank — tropical river village', description: 'A supplied river enables tropical paddy selection; fields follow real parcels.', burg: { name: 'Reedbank', population: 300, biome: 'tropical', rivers: [{ centreline: [{ x: -500, y: 90 }, { x: 500, y: 90 }], widthM: 6 }] } },
  { id: 'tropical-city', title: 'Palmreach — tropical city', description: 'Tropical architecture and vegetation in the city engine.', burg: { name: 'Palmreach', population: 10000, biome: 'tropical', walls: true, citadel: true } },
  { id: 'coastal-village', title: 'Dunewick — coastal village', description: 'A generated coast from oceanBearing, with coastal buildings and vegetation.', burg: { name: 'Dunewick', population: 300, biome: 'coastal', oceanBearing: 90, roadBearings: [{ bearing_deg: 210, kind: 'town', route_id: 'coast-road' }, { bearing_deg: 315, kind: 'local', route_id: 'dune-path' }] } },
  { id: 'coastal-city', title: 'Saltmouth — port city', description: 'Port infrastructure beside a generated coastline. This is a bearing-based coast, not a measured survey.', burg: { name: 'Saltmouth', population: 12000, biome: 'coastal', port: true, walls: true, harbourSize: 'large', oceanBearing: 90, roadBearings: [200, 300] } },
  { id: 'copperline-village', title: 'Copperline — industrial village', description: 'The same village planner with a complete replacement skin and industrial artwork.', skin: 'copperline', burg: { name: 'Copperline', population: 250, biome: 'industrial' } },
  { id: 'copperline-city', title: 'Brassworks — steampunk city', description: 'Copperline machinery and brass materials on the existing city layout and semantic feature types.', skin: 'copperline', burg: { name: 'Brassworks', population: 2000, biome: 'steampunk' } },
].map(f => ({ ...f, seed: 2, burg: { ...flags, roadBearings: roads, ...f.burg } }));
const copperline = createSkin(JSON.parse(readFileSync(new URL('docs/examples/copperline.skin.json', root), 'utf8')));
const manifest = [];
for (const fixture of fixtures) {
  const result = generateSettlement(fixture.burg, { seed: fixture.seed, ...(fixture.skin ? { skin: copperline } : {}) });
  assert.equal(result.kind, fixture.burg.population <= 1000 ? 'village' : 'settlement');
  assert.ok(result.geojson.features.length > 0);
  assert.doesNotMatch(result.svg, /NaN|Infinity/);
  writeFileSync(new URL(`${fixture.id}.svg`, out), result.svg);
  // librsvg does not support every CSS custom-property form; use the renderer-provided fallbacks.
  const rasterSvg = result.svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g, '$1');
  await sharp(Buffer.from(rasterSvg)).resize({ width: 1200 }).png({ palette: true, quality: 90, effort: 10 }).toFile(fileURLToPath(new URL(`${fixture.id}.png`, out)));
  const previewUrl = fixture.skin ? undefined : `https://settlemaker.com/fmg?i=${await encodeBurgParam(fixture.burg, fixture.seed)}`;
  manifest.push({ ...fixture, engine: result.kind, ...(previewUrl ? { previewUrl } : {}) });
  console.log(`${fixture.id}: ${result.kind}, ${result.geojson.features.length} features`);
}
// A palette example shares the exact city input and seed with the default image.
const city = fixtures.find(f => f.id === 'temperate-city');
const night = generateSettlement(city.burg, { seed: city.seed, svg: { palette: PALETTES.night } });
writeFileSync(new URL('temperate-city-night.svg', out), night.svg);
await sharp(Buffer.from(night.svg.replace(/var\(--[^,]+,\s*([^\)]+)\)/g, '$1'))).resize({ width: 1200 }).png({ palette: true, quality: 90, effort: 10 }).toFile(fileURLToPath(new URL('temperate-city-night.png', out)));
writeFileSync(new URL('fixtures.json', out), JSON.stringify({ generatorVersion: SETTLEMAKER_VERSION, fixtures: manifest }, null, 2) + '\n');
const intro = `# Gallery\n\nThese maps were generated with SettleMaker ${SETTLEMAKER_VERSION} through the public\n\`generateSettlement\` API. PNG previews and full SVGs come from the same output.\nThe gallery covers all five built-in artwork biomes in both engines, plus Copperline.\n\n[Exact inputs and seeds](examples/gallery/fixtures.json) · [Regenerate the gallery](development.md#documentation-checks)\n\nHosted preview links carry the saved inputs; the website's deployed generator may\ndiffer from this package version. Skins are loaded by the library API, so the\nCopperline examples link to their SVGs rather than an unsupported skin URL.\n\n`;
const cards = manifest.map(f => `## ${f.title}\n\n${f.description}\n\nPopulation **${f.burg.population}** · seed **${f.seed}** · engine **${f.engine}**\n\n[![${f.title}](examples/gallery/${f.id}.png)](examples/gallery/${f.id}.svg)\n\n[Full SVG](examples/gallery/${f.id}.svg)${f.previewUrl ? ` · [Hosted preview](${f.previewUrl})` : ' · [Skin JSON](examples/copperline.skin.json)'}\n`).join('\n');
writeFileSync(new URL('docs/gallery.md', root), intro + cards + '\n## One layout, another palette\n\nThornwall with the same inputs and seed, using `svg.palette: PALETTES.night`.\nCity palettes alter presentation; they do not replace all native material tokens.\nUse a skin for complete artwork and material control.\n\n[![Thornwall with the night palette](examples/gallery/temperate-city-night.png)](examples/gallery/temperate-city-night.svg)\n');
