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

export const grimhaven: AzgaarBurgInput = {
  name: 'Grimhaven', population: 1400, port: true, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 200, kind: 'road' }, { bearing_deg: 300, kind: 'road' }, { bearing_deg: 350, kind: 'foot' }],
  coastlineGeometry: [organicCoast(90, 55, 3)],
  harbourSize: 'large',
};

export const highbury: AzgaarBurgInput = {
  name: 'Highbury', population: 2600, port: false, citadel: true, walls: true,
  plaza: true, temple: true, shanty: false, capital: true,
  roadBearings: [45, 135, 225, 315],
};

export const fenwick: AzgaarBurgInput = {
  name: 'Fenwick', population: 90, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [], // authoritative: genuinely routeless → zero external roads
};

/**
 * Full route-character showcase: a through road on flat ground north, a
 * footpath trail south-east, a ridge road south-west. Growth must visibly
 * favour the northern approach; the trail stays bare.
 */
export const thornbury: AzgaarBurgInput = {
  name: 'Thornbury', population: 4000, port: false, citadel: false, walls: true,
  plaza: true, temple: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 10, route_id: 'kings-road', kind: 'road', group: 'roads', through: true, relief: 'flat' },
    { bearing_deg: 130, route_id: 'shepherds-path', kind: 'foot', group: 'trails' },
    { bearing_deg: 245, route_id: 'high-road', kind: 'road', group: 'roads', relief: 'ridge' },
  ],
};

/**
 * River-valley pull: two otherwise-equal roads, one following a river through
 * a valley (favoured), one climbing away. Growth clusters on the river road.
 */
export const riverwatch: AzgaarBurgInput = {
  name: 'Riverwatch', population: 2200, port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 80, route_id: 'vale-road', group: 'roads', through: true, relief: 'valley', followsRiver: true },
    { bearing_deg: 300, route_id: 'hill-road', group: 'roads', relief: 'ascent' },
  ],
};

/**
 * Village rows + route vectors: a riverside mill village. One through road
 * (paired bearings sharing route_id) follows the river through the valley;
 * terrace chains must string along it, with the field lane staying bare.
 */
export const millbrook: AzgaarBurgInput = {
  name: 'Millbrook', population: 320, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 70, route_id: 'mill-road', kind: 'road', group: 'roads', through: true, relief: 'valley', followsRiver: true },
    { bearing_deg: 250, route_id: 'mill-road', kind: 'road', group: 'roads', through: true, relief: 'valley', followsRiver: true },
    { bearing_deg: 160, route_id: 'field-lane', kind: 'foot', group: 'trails' },
  ],
};

/**
 * Crossroads village: two through trade roads crossing at the well.
 * Terrace chains must cluster around the crossing on all four arms.
 */
export const wayfare: AzgaarBurgInput = {
  name: 'Wayfare', population: 480, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 15, route_id: 'kings-way', kind: 'road', group: 'roads', through: true, relief: 'flat' },
    { bearing_deg: 195, route_id: 'kings-way', kind: 'road', group: 'roads', through: true, relief: 'flat' },
    { bearing_deg: 100, route_id: 'drove-road', kind: 'road', group: 'roads', through: true },
    { bearing_deg: 280, route_id: 'drove-road', kind: 'road', group: 'roads', through: true },
  ],
};

/**
 * Ford hamlet (hut family: pop < 100): a single river-following through
 * road — one short terrace of huts at the crossing, nothing else.
 */
export const fordham: AzgaarBurgInput = {
  name: 'Fordham', population: 85, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 35, route_id: 'ford-way', kind: 'road', group: 'roads', through: true, relief: 'valley', followsRiver: true },
    { bearing_deg: 215, route_id: 'ford-way', kind: 'road', group: 'roads', through: true, relief: 'valley', followsRiver: true },
  ],
};

/**
 * coreCapacity demonstration: 60 000 people against a deliberately small
 * 5 000-person core. The walled old town stays compact; the overflow lives
 * outside as faubourgs and roadside sprawl along the three routes.
 */
export const kingsmoor: AzgaarBurgInput = {
  name: 'Kingsmoor', population: 60000, port: false, citadel: true, walls: true,
  plaza: true, temple: true, shanty: true, capital: true,
  coreCapacity: 5000,
  roadBearings: [
    { bearing_deg: 0, group: 'roads', through: true, relief: 'flat' },
    { bearing_deg: 140, group: 'roads', relief: 'valley', followsRiver: true },
    { bearing_deg: 250, group: 'trails' },
  ],
};

/**
 * Everything at once: walled port on a vector coastline with rich route
 * character — the most comprehensive single payload an FMG adapter sends.
 */
export const saltmarsh: AzgaarBurgInput = {
  name: 'Saltmarsh', population: 20000, port: true, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
  harbourSize: 'large',
  coastlineGeometry: [organicCoast(90, 60, 7)],
  roadBearings: [
    { bearing_deg: 200, route_id: 'coast-road', kind: 'road', group: 'roads', through: true, relief: 'flat' },
    { bearing_deg: 285, route_id: 'inland-road', kind: 'road', group: 'roads', relief: 'valley', followsRiver: true },
    { bearing_deg: 340, route_id: 'cliff-path', kind: 'foot', group: 'trails', relief: 'ridge' },
  ],
};

async function main(): Promise<void> {
  const [gri, hig, fen, tho, riv, mil, way, forHam, kin, sal] = await Promise.all([
    encodeBurgParam(grimhaven, 11),
    encodeBurgParam(highbury, 4),
    encodeBurgParam(fenwick, 21),
    encodeBurgParam(thornbury, 3),
    encodeBurgParam(riverwatch, 5),
    encodeBurgParam(millbrook, 3),
    encodeBurgParam(wayfare, 7),
    encodeBurgParam(fordham, 5),
    encodeBurgParam(kingsmoor, 2),
    encodeBurgParam(saltmarsh, 7),
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
| Small core, big town (coreCapacity knob) | ${IMG}?name=Aldford&pop=20000&seed=9&walls=1&plaza=1&coreCapacity=4000 |

Same name + seed across the theme variants must produce the identical
layout — only colors change.

## Scaling series (footprint, texture, and the walled-core cap)

Same name/seed/flags, population only varies. Walls enclose a core capped
at \`coreCapacity\` people (default 10 000): below the cap most people live
inside a compact, densely row-housed circuit; above it the walled old town
stops growing and the overflow renders as unwalled faubourgs and roadside
sprawl around it. Generation is fast across the whole range (measured at
seed 9: ~0.1 s at pop 20 000 to ~0.5 s and a ~530 KB SVG at pop 200 000).

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

**Thornbury** — route-character showcase: through flat road N (grows a
faubourg), foot trail SE (stays bare), ridge road SW (little growth).
Extramural development must visibly favour the north.

    ${IMG}?i=${tho}

**Riverwatch** — river-valley pull: growth clusters on the road marked
\`followsRiver\`/\`valley\`, not the one marked \`ascent\`. Note: no river is
drawn — \`followsRiver\` only weights growth; river geometry is not part of
the contract yet.

    ${IMG}?i=${riv}

**Millbrook** — village rows on route vectors: a pop-320 riverside mill
village. The through road (paired bearings sharing \`route_id:
'mill-road'\`, \`followsRiver\`/\`valley\`) carries continuous house terraces;
the foot trail stays bare. One dwelling type for the whole settlement.

    ${IMG}?i=${mil}

**Wayfare** — crossroads village, pop 480: two through trade roads
(\`kings-way\`, \`drove-road\`, each a paired-bearing route) crossing at the
well. Terrace chains must cluster the crossing on all four arms, with
bare stretches further out.

    ${IMG}?i=${way}

**Fordham** — ford hamlet, pop 85 (below the hut threshold): a single
river-following through road with one short terrace of huts at the
crossing. Hut family only — no square houses may appear.

    ${IMG}?i=${forHam}

**Kingsmoor** — \`coreCapacity: 5000\` against 60 000 people: a compact
walled old town (citadel inside) surrounded by much larger unwalled sprawl
along the two real roads; the trail approach stays quiet.

    ${IMG}?i=${kin}

**Saltmarsh** — the most comprehensive single payload: walled port, vector
coastline, large harbour, and rich route character on all three approaches.
Wall must close along the water's edge with the harbour gate opening onto
piers that reach the water.

    ${IMG}?i=${sal}

## Known issues to NOT report twice (deferred-defects ledger)

- Park and Cathedral wards are currently very rare at city scale (the ward
  deck is sized against more patches than are actually dealt — tracked as a
  known defect with a pinned test, \`tests/known-defects.test.ts\`).
- Village-regime settlements (pop ≤ 600) may house fewer households than
  their census target on some seeds — terrace chains stop where frontage
  runs out, and compactness deliberately wins over completeness (owner
  ruling at the village-rows render gate). Never emptiness: a minimum
  viability pass guarantees every settlement renders dwellings.
`;

  writeFileSync('docs/test-urls.md', md);
  console.log('wrote docs/test-urls.md');
}

// Only regenerate the doc when run directly — generate-examples.ts imports
// the fixtures above and must not rewrite docs/test-urls.md as a side effect.
if (process.argv[1]?.endsWith('generate-test-urls.ts')) {
  void main();
}
