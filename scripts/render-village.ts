/**
 * Render-gate script: writes one village's SVG to stdout, a short summary
 * to stderr.
 *   nix develop --command bash -c "npx tsx scripts/render-village.ts <pop> <seed> > out.svg"
 */
import { generateVillage } from '../src/village/village-model.js';
import { renderVillage } from '../src/village/render.js';
import { hasGlyph } from '../src/village/glyphs.js';

const pop = Number(process.argv[2] ?? 300);
const seed = Number(process.argv[3] ?? 1);

const model = generateVillage({
  name: 'Gate', population: pop, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
}, seed);

process.stdout.write(renderVillage(model));

const greenGlyphId = `${model.green.shape}-${model.green.variant}`;
// The refined greens are ingested, so this should never fire any more — an
// id it does fire for is a genuine bug (an unproduced green shape/variant
// or a manifest regression), not an asset gap to wait on.
const greenIsStandIn = !hasGlyph(greenGlyphId);

process.stderr.write(
  `${model.buildings.length} buildings, ${model.lanes.length} lanes, ` +
  `green ${model.green.shape} ${Math.round(model.green.diameter)} m` +
  `${greenIsStandIn ? ' (WARNING: green glyph missing from manifest, no ground drawn)' : ''}\n` +
  model.diagnostics.map((d) => `  ! ${d}\n`).join(''),
);
