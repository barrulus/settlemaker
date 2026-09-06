/**
 * Run `settlement-tiler` against a VILLAGE — it has only ever seen the city
 * renderer's output.
 *
 * The village SVG shares the `data-bg="paper"` crop contract but is otherwise
 * a different document: a water band, and three alignment attributes on the
 * root element that the city path does not emit.
 *
 *   nix develop --command bash -c "npx tsx scripts/tile-village-check.ts"
 */
import fs from 'node:fs';
import sharp from 'sharp';
import {
  generateVillage, renderVillage,
  parseSvgViewBox, computeTileInfo, cropSvgToTile, enumerateTiles, totalTileCount,
} from '../src/index.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const OUT = '/home/barrulus/settlemaker-village-gate';
const flags = { port: false, citadel: false, walls: false, plaza: false, temple: false, shanty: false, capital: false };

const CASES: Array<{ name: string; burg: AzgaarBurgInput }> = [
  { name: 'dry', burg: { ...flags, name: 'Tileton', population: 900,
      roadBearings: [{ bearing_deg: 40, kind: 'main', through: true, route_id: 'r-main' },
                     { bearing_deg: 165, kind: 'town', route_id: 'r-town' }] } as AzgaarBurgInput },
  { name: 'coastal', burg: { ...flags, name: 'Tilemouth', population: 900, port: true,
      roadBearings: [{ bearing_deg: 270, kind: 'main', route_id: 'r-shore' }],
      coastlineGeometry: [[{ x: -900, y: 90 }, { x: 900, y: 90 }, { x: 900, y: 900 }, { x: -900, y: 900 }]] } as AzgaarBurgInput },
];

async function main(): Promise<void> {
  for (const { name, burg } of CASES) {
    const model = generateVillage(burg, 1);
    const svg = renderVillage(model);
    const vb = parseSvgViewBox(svg);
    if (!vb) throw new Error(`${name}: the tiler cannot read the village viewBox`);
    const info = computeTileInfo(vb, burg.population);
    process.stdout.write(
      `\n${name}: viewBox ${vb.width.toFixed(0)}x${vb.height.toFixed(0)} -> maxZoom ${info.maxZoom}, `
      + `${totalTileCount(info.maxZoom)} tiles, ${info.metersPerUnit.toFixed(4)} m/unit\n`,
    );

    let rendered = 0;
    let bgKept = 0;
    let empty = 0;
    for (const t of enumerateTiles(info.maxZoom)) {
      const tile = cropSvgToTile(svg, info, t.z, t.x, t.y, 256);
      if (tile.includes('data-bg="paper"')) bgKept += 1;
      const png = await sharp(Buffer.from(tile), { density: 96 }).png().toBuffer();
      const stats = await sharp(png).stats();
      // A tile that is a single flat colour has zero standard deviation on
      // every channel — nothing was drawn into it.
      if (stats.channels.every((c) => c.stdev < 0.5)) empty += 1;
      rendered += 1;
      if (t.z === info.maxZoom && t.x === 0 && t.y === 0) {
        fs.writeFileSync(`${OUT}/tile-${name}-z${t.z}-0-0.png`, png);
      }
    }
    process.stdout.write(
      `  ${rendered} tiles rasterised, ${bgKept} kept the data-bg contract, ${empty} are flat colour\n`,
    );
  }
}
main().catch((e) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
