// Run after npm run build. Artifacts deliberately stay outside tracked sources.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createSettlementModel, renderSettlement, exportSettlement } from '../dist/index.js';

const out = new URL('../output/harbour-review/', import.meta.url);
await mkdir(out, { recursive: true });
const tetlapan = JSON.parse(await readFile(new URL('../tests/fixtures/tetlapan-coast.json', import.meta.url), 'utf8'));
const measured = {
  ...tetlapan.burg, name: 'Measured coast', population: 4000, capital: false, citadel: false,
  roadBearings: [270], oceanBearing: 270, harbourWaterKind: 'ocean',
  coastlineGeometry: [[{ x: 120, y: -4000 }, { x: 4000, y: -4000 }, { x: 4000, y: 4000 }, { x: 120, y: 4000 }]],
  waterContext: { version: 1, status: 'measured', coordinateSpace: 'burg-local-metres', surveyRadiusM: 4000,
    geometryErrorM: .5, bodies: [{ featureId: '9', kind: 'ocean', distanceM: 120, bearingDeg: 90, polygonIndices: [0] }] },
};
const boundsOf = (points, pad) => ({
  min_x: Math.min(...points.map(p => p.x)) - pad, min_y: Math.min(...points.map(p => p.y)) - pad,
  max_x: Math.max(...points.map(p => p.x)) + pad, max_y: Math.max(...points.map(p => p.y)) + pad,
});
const report = [];
for (const [name, input, seed] of [['tetlapan', tetlapan.burg, tetlapan.seed], ['measured-ocean', measured, 2]]) {
  const start = performance.now(), model = createSettlementModel(input, { seed });
  const generationMs = Math.round(performance.now() - start);
  const harbour = model.scene.layers.harbours?.[0];
  if (!harbour) throw new Error(`${name}: missing harbour`);
  const warehouses = model.scene.layers.buildings.filter(b => b.kind === 'harbour');
  const harbourPoints = [...harbour.quays.flatMap(q => q.ring), ...harbour.breakwaters.flatMap(b => b.ring),
    ...harbour.berths.flatMap(b => b.ring), ...warehouses.flatMap(b => b.ring)];
  const urbanPoints = model.buildings.filter(b => b.settlementRole !== 'rural').flatMap(b => b.footprint);
  for (const [view, bounds] of [['harbour', boundsOf(harbourPoints, 25)], ['city', boundsOf(urbanPoints, 100)], ['landscape', model.scene.bounds]]) {
    if (process.argv.includes('--harbour-only') && view !== 'harbour') continue;
    const svg = renderSettlement(model, { bounds, width: 1600, detail: view === 'harbour' ? 'full' : 'auto' });
    await writeFile(new URL(`${name}-${view}.svg`, out), svg);
    await sharp(Buffer.from(svg)).resize({ width: 1600, height: 1200, fit: 'inside' }).png().toFile(new URL(`${name}-${view}.png`, out).pathname);
  }
  if (!process.argv.includes('--harbour-only')) await writeFile(new URL(`${name}.geojson`, out), JSON.stringify(exportSettlement(model)));
  report.push({ name, seed, generationMs, kind: harbour.kind, berths: harbour.berths.length,
    breakwaters: harbour.breakwaters.length, warehouses: warehouses.length,
    wallReachM: Math.max(0, ...harbour.breakwaters.map(b => Math.hypot(b.path[1].x - b.path[0].x, b.path[1].y - b.path[0].y))),
    entranceWidthM: Math.hypot(harbour.entrance[1].x - harbour.entrance[0].x, harbour.entrance[1].y - harbour.entrance[0].y),
    warehouseGlyphs: warehouses.filter(b => b.glyphBacked).length, navigationWidthM: harbour.navigationWidth,
    residents: model.residents, diagnostics: model.diagnostics });
}
await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
