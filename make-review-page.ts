/**
 * Generates web/public/review.html — a contact sheet of settlements across the
 * population ladder, so shape/sprawl decisions can be judged visually rather
 * than from patch-count tables. Throwaway review aid; not part of the build.
 *
 *   nix develop --command bash -c "npx tsx make-review-page.ts"
 */
import { writeFileSync } from 'node:fs';
import { encodeBurgParam, type AzgaarBurgInput } from './src/index.js';

const BASE = 'http://localhost:5199/fmg';

const CROSSROADS = [0, 120, 240];

/**
 * Walls default to what FMG would actually send: a hamlet has none, a town
 * and anything larger does. Forcing `walls: true` on the pop-300 entry made
 * the smallest fixture unrepresentative (and gave it gate wards it would
 * never have).
 */
const WALLED_FROM = 1000;

function burg(overrides: Partial<AzgaarBurgInput> & { name: string; population: number }): AzgaarBurgInput {
  return {
    port: false, citadel: false, walls: overrides.population >= WALLED_FROM,
    plaza: true, temple: false, shanty: false, capital: false,
    roadBearings: CROSSROADS,
    ...overrides,
  };
}

interface Cell { label: string; note: string; burg: AzgaarBurgInput; seed: number }

const cells: Cell[] = [
  // The population ladder — the thing under review.
  { label: 'pop 300', note: 'hamlet · unwalled (FMG would not wall it) · target ~8% outside', burg: burg({ name: 'Threehundred', population: 300 }), seed: 3 },
  { label: 'pop 1 200', note: 'village · target ~14%', burg: burg({ name: 'Twelvehundred', population: 1200 }), seed: 3 },
  { label: 'pop 4 000', note: 'town · target ~20%', burg: burg({ name: 'Fourthousand', population: 4000 }), seed: 3 },
  { label: 'pop 10 000', note: 'large town · target ~25%', burg: burg({ name: 'Tenthousand', population: 10000 }), seed: 3 },
  { label: 'pop 50 000', note: 'city · cap binds · target ~80% outside', burg: burg({ name: 'Fiftythousand', population: 50000, citadel: true }), seed: 3 },
  { label: 'pop 250 000', note: 'metropolis · cap binds · target ~96% outside', burg: burg({ name: 'Quartermillion', population: 250000, citadel: true, shanty: true }), seed: 3 },

  // Controls.
  { label: 'pop 4 000 · no roads', note: 'roadBearings: [] — six-direction fallback belt', burg: burg({ name: 'Roadless', population: 4000, roadBearings: [] }), seed: 3 },
  { label: 'pop 4 000 · two roads', note: 'opposed roads — should elongate', burg: burg({ name: 'Ribbonford', population: 4000, roadBearings: [90, 270] }), seed: 3 },
  { label: 'pop 4 000 · unwalled', note: 'walls: false — no gate wards to muddy the picture', burg: burg({ name: 'Openton', population: 4000, walls: false }), seed: 3 },
  { label: 'pop 20 000 · port', note: 'oceanBearing 90 — water must suppress that side', burg: burg({ name: 'Saltmouth', population: 20000, port: true, oceanBearing: 90, harbourSize: 'large' }), seed: 3 },
];

async function main(): Promise<void> {
const items = await Promise.all(cells.map(async (c) => {
  const url = `${BASE}?i=${await encodeBurgParam(c.burg, c.seed)}`;
  return { ...c, url };
}));

const html = `<!doctype html>
<meta charset="utf-8">
<title>settlemaker — shape review</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { opacity: .7; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px; }
  .cell { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 8px; overflow: hidden; }
  .cap { padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  .cap b { display: block; }
  .cap span { opacity: .7; font-size: 12px; }
  iframe { width: 100%; height: 340px; border: 0; display: block; background: #fff; }
  a { font-size: 11px; opacity: .6; word-break: break-all; padding: 6px 10px; display: block; }
</style>
<h1>settlemaker — shape review</h1>
<div class="sub">branch <code>roundness-and-fields</code>. Reload to pick up generator changes.</div>
<div class="grid">
${items.map(i => `  <div class="cell">
    <div class="cap"><b>${i.label}</b><span>${i.note}</span></div>
    <iframe src="${i.url}" loading="lazy"></iframe>
    <a href="${i.url}" target="_blank">open standalone</a>
  </div>`).join('\n')}
</div>
`;

writeFileSync('web/public/review.html', html);
console.log(`wrote web/public/review.html with ${items.length} settlements`);
for (const i of items) console.log(`  ${i.label}: ${i.url.length} chars`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
