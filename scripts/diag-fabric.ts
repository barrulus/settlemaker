/**
 * Fabric diagnostic: does the housing follow the ROADS, or ring the GREEN?
 *
 * The full render buries this under fields and woodland. This strips the
 * village to the three things that answer the question -- the FMG roads
 * (thick, dark), the streets the village invented for itself (thin, grey),
 * and the houses -- and zooms to the built-up area.
 *
 *   nix develop --command bash -c "npx tsx scripts/diag-fabric.ts"
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { generateVillage } from '../src/village/village-model.js';
import { isTrunk } from '../src/village/skeleton/trunks.js';
import { dist } from '../src/village/geometry.js';
import { SCENARIOS } from './probe-afmg.js';

const OUT = '/home/barrulus/settlemaker-village-gate';
const CASES: Array<[string, number]> = [['panel-through', 900], ['hub', 300]];

const n = (x: number): string => (Math.round(x * 100) / 100).toString();

function draw(name: string, pop: number, seed: number): string {
  const sc = SCENARIOS.find((s) => s.name === name)!;
  const m = generateVillage(sc.input(pop), seed);
  const c = m.green.centre;
  const radii = m.buildings.map((b) => dist(b.position, c)).sort((a, b) => a - b);
  const extent = (radii[Math.floor(radii.length * 0.98)] ?? 60) * 1.25;
  const px = 900 / (extent * 2);
  const X = (x: number): number => (x - c.x + extent) * px;
  const Y = (y: number): number => (y - c.y + extent) * px;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="940" viewBox="0 0 900 940">`);
  out.push('<rect width="900" height="940" fill="#f4efe4"/>');
  out.push(`<text x="12" y="24" font-family="monospace" font-size="15" fill="#3d3527">`
    + `${name} pop ${pop} — thick = FMG roads, thin = the village's own streets</text>`);
  out.push('<g transform="translate(0,32)">');

  // The green.
  out.push(`<circle cx="${n(X(c.x))}" cy="${n(Y(c.y))}" r="${n((m.green.diameter / 2) * px)}" `
    + 'fill="#b9cf94"/>');

  // Invented streets first, then FMG roads over them.
  for (const l of m.lanes) {
    if (l.points.length < 2 || isTrunk(l.id)) continue;
    const d = l.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(X(p.x))} ${n(Y(p.y))}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="#b0a893" stroke-width="1.6"/>`);
  }
  for (const l of m.lanes) {
    if (l.points.length < 2 || !isTrunk(l.id)) continue;
    const d = l.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(X(p.x))} ${n(Y(p.y))}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="#4a3f2c" stroke-width="5" stroke-linecap="round"/>`);
  }

  // Houses.
  for (const b of m.buildings) {
    const [w, h] = b.footprint;
    out.push(`<rect x="${n(X(b.position.x) - (w * px) / 2)}" y="${n(Y(b.position.y) - (h * px) / 2)}" `
      + `width="${n(w * px)}" height="${n(h * px)}" `
      + `transform="rotate(${n(b.bearingDeg)} ${n(X(b.position.x))} ${n(Y(b.position.y))})" `
      + 'fill="#d9a08a" stroke="#7a5b4a" stroke-width="0.7"/>');
  }
  out.push('</g></svg>');
  return out.join('');
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, pop] of CASES) {
    const svg = draw(name, pop, 1);
    const stem = `${OUT}/fabric-${name}-${pop}`;
    fs.writeFileSync(`${stem}.svg`, svg);
    await sharp(Buffer.from(svg)).png().toFile(`${stem}.png`);
    process.stdout.write(`${stem}.png\n`);
  }
}
main().catch((e) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
