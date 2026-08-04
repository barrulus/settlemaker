/**
 * Before/after comparison harness for the fidelity-core changes (2026-08-04).
 *
 * Runs the same burg inputs through the OLD generator (baseline worktree
 * pinned at 4faa53a, pre-fidelity) and the NEW one (./src), and writes a
 * side-by-side gallery to output/compare/index.html.
 *
 * Run:    nix develop --command bash -c "npx tsx compare-versions.ts"
 * Setup:  the baseline worktree must exist:
 *         git worktree add .claude/worktrees/baseline-pre-fidelity 4faa53a --detach
 * Remove: git worktree remove .claude/worktrees/baseline-pre-fidelity
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateFromBurg as generateNew, type AzgaarBurgInput } from './src/index.js';
// eslint-disable-next-line import/no-relative-packages
import { generateFromBurg as generateOld } from './.claude/worktrees/baseline-pre-fidelity/src/index.js';
import { toprak } from './tests/fixtures/toprak.js';

const BUDGET_EXEMPT = new Set(['castle', 'cathedral', 'market', 'harbour', 'park']);

// Count ordinary (budget-relevant) buildings; works on both model versions
// by comparing ward.type string values rather than enum instances.
function countBuildings(model: { patches: Array<{ ward: { type: string; geometry: unknown[] } | null }> }): number {
  let n = 0;
  for (const patch of model.patches) {
    if (!patch.ward || BUDGET_EXEMPT.has(String(patch.ward.type))) continue;
    n += patch.ward.geometry.length;
  }
  return n;
}

interface Case {
  label: string;
  note: string;
  burg: AzgaarBurgInput;
}

/**
 * Organic coastline: a meandering shore roughly `shoreDist` units from the
 * origin in the compass direction `bearingDeg`, closed far out to sea.
 * Mimics the smoothed vector coastlines questables extracts from world data
 * (rectangles are NOT representative input — the renderer draws rings
 * faithfully, so test geometry must look like real geometry).
 */
function organicCoast(bearingDeg: number, shoreDist: number, seed: number): Array<{ x: number; y: number }> {
  const rad = bearingDeg * Math.PI / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad); // toward sea
  const tx = -dy, ty = dx;                        // along the shore
  const pts: Array<{ x: number; y: number }> = [];
  for (let s = -1600; s <= 1600; s += 40) {
    const wobble =
      30 * Math.sin(s / 230 + seed * 1.7) +
      12 * Math.sin(s / 67 + seed * 3.1) +
      5 * Math.sin(s / 21 + seed * 5.3);
    const d = shoreDist + wobble;
    pts.push({ x: tx * s + dx * d, y: ty * s + dy * d });
  }
  pts.push({ x: tx * 1600 + dx * 2500, y: ty * 1600 + dy * 2500 });
  pts.push({ x: tx * -1600 + dx * 2500, y: ty * -1600 + dy * 2500 });
  return pts;
}

const seaSouth = [organicCoast(180, 55, 2)];
const seaEastB = [organicCoast(90, 55, 3)];

const CASES: Case[] = [
  {
    label: 'Toprak — the bug report',
    note: 'pop 13, coastal, one trail from the west. Old: pond + extra houses. New: open sea to frame edge, ≤3 houses, exactly 1 road. (Organic shoreline standing in for the regression fixture’s rectangle.)',
    burg: { ...toprak, coastlineGeometry: [organicCoast(90, 40, 4)] },
  },
  {
    label: 'Saltmere — small coastal port',
    note: 'pop 350, small harbour, sea south, roads W + N. Water shape + pier placement vs before.',
    burg: {
      name: 'Saltmere', population: 350, port: true, citadel: false, walls: false,
      plaza: true, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 250, kind: 'road', route_id: 'r-west' }, { bearing_deg: 10, kind: 'foot', route_id: 'f-north' }],
      coastlineGeometry: seaSouth, harbourSize: 'small',
    },
  },
  {
    label: 'Grimhaven — walled port town',
    note: 'pop 4500, large harbour, walls+plaza+temple, 3 routes, sea east. Budget should NOT bind; water fidelity is the visible change.',
    burg: {
      name: 'Grimhaven', population: 4500, port: true, citadel: false, walls: true,
      plaza: true, temple: true, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 200, kind: 'road' }, { bearing_deg: 270, kind: 'road' }, { bearing_deg: 330, kind: 'foot' }],
      coastlineGeometry: seaEastB, harbourSize: 'large',
    },
  },
  {
    label: 'Highbury — inland walled city',
    note: 'pop 9000, citadel, 4 routes, no water. Control case: should look essentially unchanged.',
    burg: {
      name: 'Highbury', population: 9000, port: false, citadel: true, walls: true,
      plaza: true, temple: true, shanty: false, capital: true,
      roadBearings: [45, 135, 225, 315],
    },
  },
  {
    label: 'Fenwick — routeless hamlet',
    note: 'pop 60, roadBearings: [] (explicitly no routes). Old: invented random roads. New: zero external roads.',
    burg: {
      name: 'Fenwick', population: 60, port: false, citadel: false, walls: false,
      plaza: false, temple: false, shanty: false, capital: false,
      roadBearings: [],
    },
  },
  {
    label: 'Greyshore — oceanBearing fallback',
    note: 'pop 1200, oceanBearing=90 only (no vector coastline). Old: patch-painted enclosed lake. New: seed-derived organic synthetic coast, open ocean to frame edge, piers anchored to the shore.',
    burg: {
      name: 'Greyshore', population: 1200, port: true, citadel: false, walls: false,
      plaza: true, temple: false, shanty: false, capital: false,
      roadBearings: [{ bearing_deg: 270, kind: 'road' }],
      oceanBearing: 90, harbourSize: 'small',
    },
  },
];

function cell(svg: string, stats: string): string {
  return `<td><div class="frame">${svg}</div><p class="stats">${stats}</p></td>`;
}

const rows: string[] = [];
for (const c of CASES) {
  const oldR = generateOld(c.burg as never);
  // Unique clip id per panel — SVG ids are document-global, and this page
  // inlines every settlement's SVG (the exact collision SvgOptions.clipId exists for).
  const newR = generateNew(c.burg, { svg: { clipId: `frame-clip-${c.burg.name.toLowerCase()}` } });
  const oldStats = `buildings ${countBuildings(oldR.model)} · roads ${oldR.model.roads.length}`;
  const newStats = `buildings ${countBuildings(newR.model)} · roads ${newR.model.roads.length}`;
  console.log(`${c.burg.name.padEnd(10)} old[${oldStats}]  new[${newStats}]`);
  rows.push(`
    <tr><th colspan="2"><h2>${c.label}</h2><p>${c.note}</p></th></tr>
    <tr class="pair">${cell(oldR.svg, `OLD (4faa53a) — ${oldStats}`)}${cell(newR.svg, `NEW (master) — ${newStats}`)}</tr>`);
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>settlemaker fidelity: before / after</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #f5f2e8; color: #333; }
  table { border-collapse: collapse; width: 100%; max-width: 1400px; margin: 0 auto; }
  th { text-align: left; padding-top: 2rem; }
  h2 { margin: 0 0 .25rem; } th p { margin: 0; font-weight: normal; color: #666; }
  td { width: 50%; padding: .5rem; vertical-align: top; }
  .frame svg { width: 100%; height: auto; border: 1px solid #bbb; background: white; display: block; }
  .stats { margin: .35rem 0 0; font-size: .85rem; color: #555; font-variant-numeric: tabular-nums; }
</style></head><body>
<h1>settlemaker fidelity-core: before / after</h1>
<p>Left: pre-fix baseline (commit 4faa53a). Right: current master. Same input, same seed per burg.</p>
<table>${rows.join('\n')}</table>
</body></html>`;

mkdirSync('output/compare', { recursive: true });
writeFileSync('output/compare/index.html', html);
console.log('\nwrote output/compare/index.html');
