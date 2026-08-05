/**
 * Regenerates docs/test-urls.md — the manual verification links for the
 * deployed site. Run after any change to the URL codec, param parsing, or
 * generator defaults:
 *
 *   nix develop --command bash -c "npx tsx generate-test-urls.ts"
 */
import { writeFileSync } from 'node:fs';
import { encodeBurgParam, type AzgaarBurgInput } from './src/index.js';

const BASE = 'https://settlemaker.netlify.app';

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
\`npx tsx generate-test-urls.ts\` after codec or generator changes — the
\`i=\` payloads below are version-bound (\`v: 1\`).

Base: ${BASE}

## Page behavior

| Check | URL | Expect |
|---|---|---|
| Random demo | ${BASE}/ | A different settlement per reload, filling the viewport |
| Broken payload | ${BASE}/?i=garbage | Parchment error card, reason \`base64\`/\`inflate\` — never a blank page |
| Unknown theme | ${BASE}/?name=X&pop=100&theme=nope | Error card listing the known theme presets |

## Flat parameter tier

| Check | URL |
|---|---|
| Coastal village, bearing-only water (organic synthetic shore) | ${BASE}/?name=Saltmere&pop=350&seed=3&port=1&plaza=1&oceanBearing=180&harbourSize=small |
| Walled town, classic theme | ${BASE}/?name=Aldford&pop=1400&seed=9&walls=1&plaza=1&temple=1&theme=classic |
| Same town, night theme | ${BASE}/?name=Aldford&pop=1400&seed=9&walls=1&plaza=1&temple=1&theme=night |
| Same town, ink theme | ${BASE}/?name=Aldford&pop=1400&seed=9&walls=1&plaza=1&temple=1&theme=ink |

Same name + seed across the theme variants must produce the identical
layout — only colors change.

## Compressed \`i=\` payloads (the FMG channel)

**Grimhaven** — walled port on an organic vector coastline, 3 routes,
large harbour. The showcase link.

    ${BASE}/?i=${gri}

**Highbury** — inland walled capital with citadel, 4 roads at the
cardinal diagonals.

    ${BASE}/?i=${hig}

**Fenwick** — routeless hamlet (\`roadBearings: []\`): must render ZERO
external roads.

    ${BASE}/?i=${fen}

## Known issues to NOT report twice (fidelity round 2 backlog)

- Large walled towns (pop ≳ 2000) show an empty band between the built
  core and the wall (budget trim keeps nearest-centre buildings).
- In \`oceanBearing\` mode the harbour district can sit inland of the
  painted shoreline (piers are rescued to the water; warehouses are not).
- Settlement outlines are still quite circular.
`;

  writeFileSync('docs/test-urls.md', md);
  console.log('wrote docs/test-urls.md');
}

void main();
