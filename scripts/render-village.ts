/**
 * Render-gate script: writes one village's SVG to stdout, a short summary
 * to stderr.
 *   nix develop --command bash -c "npx tsx scripts/render-village.ts <pop> <seed> > out.svg"
 */
import { generateSettlement } from '../src/index.js';

const pop = Number(process.argv[2] ?? 300);
const seed = Number(process.argv[3] ?? 1);

const { model, svg } = generateSettlement({
  name: 'Gate', population: pop, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
}, { seed, engine: 'village' });

process.stdout.write(svg);
process.stderr.write(
  `${model.buildings.length} buildings, ${model.scene.layers.roads.length} roads, ` +
  `${model.residents.assigned} residents housed\n` +
  model.diagnostics.map((d) => `  ! ${d}\n`).join(''),
);
