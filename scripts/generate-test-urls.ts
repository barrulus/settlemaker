/**
 * Regenerates docs/test-urls.md — the manual verification links for the
 * deployed site. Run after any change to the URL codec, param parsing, or
 * generator defaults:
 *
 *   nix develop --command bash -c "npx tsx scripts/generate-test-urls.ts"
 */
import { writeFileSync } from 'node:fs';
import { encodeBurgParam, type AzgaarBurgInput } from '../src/index.js';

const BASE = 'https://settlemaker.com';
/** The machine endpoint; the bare site root serves the human builder. */
const IMG = `${BASE}/fmg`;

/** Organic meandering shoreline, same shape as the compare-versions harness. */
function organicCoast(bearingDeg: number, shoreDist: number, seed: number): Array<{ x: number; y: number }> {
  const rad = bearingDeg * Math.PI / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const tx = -dy, ty = dx;
  const pts: Array<{ x: number; y: number }> = [];
  for (let s = -1600; s <= 1600; s += 40) {
    const wobble = 30 * Math.sin(s / 230 + seed * 1.7) + 12 * Math.sin(s / 67 + seed * 3.1) + 5 * Math.sin(s / 21 + seed * 5.3);
    pts.push({ x: tx * s + dx * (shoreDist + wobble), y: ty * s + dy * (shoreDist + wobble) });
  }
  pts.push({ x: tx * 1600 + dx * 2500, y: ty * 1600 + dy * 2500 });
  pts.push({ x: -tx * 1600 + dx * 2500, y: -ty * 1600 + dy * 2500 });
  return pts;
}

const grimhaven: AzgaarBurgInput = {
  name: 'Grimhaven', population: 1400, port: true, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 200, kind: 'road' }, { bearing_deg: 300, kind: 'road' }, { bearing_deg: 350, kind: 'foot' }],
  coastlineGeometry: [organicCoast(90, 55, 3)],
  harbourSize: 'large',
};

const highbury: AzgaarBurgInput = {
  name: 'Highbury', population: 2600, port: false, citadel: true, walls: true,
  plaza: true, temple: true, shanty: false, capital: true,
  roadBearings: [45, 135, 225, 315],
};

const fenwick: AzgaarBurgInput = {
  name: 'Fenwick', population: 90, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [], // authoritative: genuinely routeless → zero external roads
};

async function main(): Promise<void> {
  const [gri, hig, fen] = await Promise.all([
    encodeBurgParam(grimhaven, 11),
    encodeBurgParam(highbury, 4),
    encodeBurgParam(fenwick, 21),
  ]);

  const md = `# Test URLs

Manual verification links for the deployed renderer. Regenerate with
\`npx tsx scripts/generate-test-urls.ts\` after codec or generator changes — the
\`i=\` payloads below are version-bound (\`v: 1\`).

Builder (human landing page): ${BASE}/
Image endpoint (URL contract): ${IMG}

## Page behavior

| Check | URL | Expect |
|---|---|---|
| Builder page | ${BASE}/ | Human landing page: form, live preview, copyable image links |
| Random demo | ${IMG} | A different settlement per reload, filling the viewport |
| Broken payload | ${IMG}?i=garbage | Parchment error card, reason \`base64\`/\`inflate\` — never a blank page |
| Unknown theme | ${IMG}?name=X&pop=100&theme=nope | Error card listing the known theme presets |

## Flat parameter tier

| Check | URL |
|---|---|
| Coastal village, bearing-only water (organic synthetic shore) | ${IMG}?name=Saltmere&pop=350&seed=3&port=1&plaza=1&oceanBearing=180&harbourSize=small |
| Walled town, classic theme | ${IMG}?name=Aldford&pop=1400&seed=9&walls=1&plaza=1&temple=1&theme=classic |
| Same town, night theme | ${IMG}?name=Aldford&pop=1400&seed=9&walls=1&plaza=1&temple=1&theme=night |
| Same town, ink theme | ${IMG}?name=Aldford&pop=1400&seed=9&walls=1&plaza=1&temple=1&theme=ink |

Same name + seed across the theme variants must produce the identical
layout — only colors change.

## Scaling series (round 4: footprint and texture vs population)

Same name/seed/flags, population only varies. This is the canonical
demonstration that wall size, footprint count, and texture density all
grow with population instead of flattening out at a fixed patch count.
Expected patch counts at seed 9: 20k → 56, 30k → 84, 70k → 195,
200k → 220 (the cap — see known issues below).

Caution: the 200,000-population URL is expensive — measured 2923ms
generation, a 3832 KB SVG, and a 5739 KB GeoJSON — and generation is
synchronous on the main thread, so the page blocks (no spinner) while it
runs. Expect a multi-second freeze before it renders.

| pop | URL |
|---|---|
| 20,000 | ${IMG}?name=Aldford&pop=20000&seed=9&walls=1&plaza=1&temple=1&theme=ink |
| 30,000 | ${IMG}?name=Aldford&pop=30000&seed=9&walls=1&plaza=1&temple=1&theme=ink |
| 70,000 | ${IMG}?name=Aldford&pop=70000&seed=9&walls=1&plaza=1&temple=1&theme=ink |
| 200,000 | ${IMG}?name=Aldford&pop=200000&seed=9&walls=1&plaza=1&temple=1&theme=ink |

## Compressed \`i=\` payloads (the FMG channel)

**Grimhaven** — walled port on an organic vector coastline, 3 routes,
large harbour. The showcase link.

    ${IMG}?i=${gri}

**Highbury** — inland walled capital with citadel, 4 roads at the
cardinal diagonals.

    ${IMG}?i=${hig}

**Fenwick** — routeless hamlet (\`roadBearings: []\`): must render ZERO
external roads.

    ${IMG}?i=${fen}

## Known issues to NOT report twice (fidelity round 2-4 backlog)

- Settlement outlines are still quite circular.
- When no patch straddles the painted shoreline (mesh-dependent, e.g. some
  seeds in oceanBearing mode), harbour placement falls back to patch
  adjacency and the district can sit inland of the visible waterline; piers
  are rescued to the shore, warehouses are not.
- A thin single-patch gap can still show between the outermost building row
  and the wall on some seeds — the proportional trim leaves a small empty
  band inside walls (measured ≈10.7% of wall radius on the Salt Harbour
  reference fixture as of round 4, down from ≈16% at round 3 and ≈9%
  pre-curve; test ceiling 25%. Round 4 did not touch the trim policy, so
  this is a re-measurement, not a fix).
- Piers on obliquely-crossing shores can occasionally sit fully on land (they
  extend along the patch edge normal, not toward the water).
- Megacities beyond ~pop 79,000 (round 4): households (pop / 30) exceed the
  220-patch cap, so the footprint count and per-patch layout stop growing
  and the remaining population is absorbed by denser in-patch texture
  instead of more distinct footprints. Wall size keeps scaling with
  population; only the fine-grained building texture compresses past the
  boundary. The Aldford scaling series above brackets this — 20k and 30k
  sit below the boundary with distinct individual footprints, 70k is close
  to it, 200k is well past it and shows compressed texture.
`;

  writeFileSync('docs/test-urls.md', md);
  console.log('wrote docs/test-urls.md');
}

void main();
