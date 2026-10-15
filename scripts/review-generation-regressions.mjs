/** Reproduce reported generation defects without involving viewer caches or tiles.
 * npm run build && node scripts/review-generation-regressions.mjs --png
 * Compare revisions at identical bounds:
 *   --engine /tmp/baseline.mjs --out /tmp/before
 *   --out /tmp/after --frames /tmp/before/frames.json
 * PNG output is optional; SVGs and JSON are always emitted. Wide rural views
 * intentionally use automatic detail, matching the viewer's scale semantics.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boundsOfPoints } from '../dist/geom/bounds.js';
import { nearestOnSegment } from '../dist/generator/city-frontage.js';
import { pointInPolygon } from '../dist/geom/point-in-polygon.js';
import { Polygon } from '../dist/geom/polygon.js';
import { Point } from '../dist/types/point.js';
import { linkedBuildingIds } from '../dist/scene/symbol-buildings.js';

const args = process.argv.slice(2);
function argument(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value`);
  return args[index + 1];
}
const enginePath = argument('--engine', fileURLToPath(new URL('../dist/index.js', import.meta.url)));
const engineUrl = enginePath.startsWith('file:') ? enginePath : pathToFileURL(resolve(enginePath)).href;
const engine = await import(engineUrl);
const out = resolve(argument('--out', 'output/generation-regressions'));
const previousFrames = argument('--frames');
const frames = previousFrames ? JSON.parse(await readFile(previousFrames, 'utf8')) : {};
const png = args.includes('--png');
const sharp = png ? (await import('sharp')).default : undefined;
await mkdir(out, { recursive: true });

const fixtures = [
  { id: 'aldford-1200', query: 'name=Aldford&pop=1200&seed=353956&walls=1&plaza=1&roads=316%3Alocal%2C146%3Alocal%2C282%3Afootpath' },
  { id: 'aldford', query: 'name=Aldford&pop=3400&seed=60891&walls=1&plaza=1&roads=355%3Atrail%2C135%3Amarket%2C236%3Amarket' },
  { id: 'rural', query: 'name=Rural&pop=10000&seed=2&walls=1', development: { preset: 'city', corePopulation: 5000, ruralPopulation: 1000 } },
];
function bounds(points) {
  if (!points.length) throw new Error('Expected fixture geometry is missing');
  return boundsOfPoints(points);
}
function pad(b, fraction = .04) {
  const x = (b.max_x - b.min_x) * fraction, y = (b.max_y - b.min_y) * fraction;
  return { min_x: b.min_x - x, min_y: b.min_y - y, max_x: b.max_x + x, max_y: b.max_y + y };
}
function center(ring) {
  return new Polygon(ring.map(p => new Point(p.x, p.y))).centroid;
}
function area(ring) {
  return Math.abs(new Polygon(ring.map(p => new Point(p.x, p.y))).square);
}
function resized(svg, b, width) {
  const w = b.max_x - b.min_x, h = b.max_y - b.min_y;
  return svg.replace(/<svg\b[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(width * h / w)}" viewBox="${b.min_x} ${b.min_y} ${w} ${h}">`);
}
function uses(svg) {
  const glyphs = [...svg.matchAll(/<use href="#glyph-([^" ]+)"[^>]*data-building-id="([^"]+)"[^>]*>/g)].filter(m => !m[1].endsWith('-sil'));
  const backed = new Set(glyphs.flatMap(m => linkedBuildingIds({buildingId:m[2],
    ...(m[0].match(/data-building-ids="([^"]*)"/) ? {buildingIds:m[0].match(/data-building-ids="([^"]*)"/)[1].split(' ').filter(Boolean)} : {})})));
  return { glyphs: glyphs.length, glyphBackedFootprints: backed.size, highDensityGlyphs: glyphs.filter(m => /tenement|terrace|courtyard/.test(m[1])).length,
    rowHouseGlyphs: glyphs.filter(m => /row-house/.test(m[1])).length,
    shopHouseGlyphs: glyphs.filter(m => /shop-house/.test(m[1])).length,
    plainFootprints: [...svg.matchAll(/<path class="([^"]+)" data-building-id=/g)].length };
}
function distance(p, a, b) {
  const nearest = nearestOnSegment(p, a, b);
  return Math.hypot(p.x - nearest.x, p.y - nearest.y);
}
function quantiles(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return { count: values.length, medianMetres: values[Math.floor(values.length / 2)], p95Metres: values[Math.ceil(values.length * .95) - 1], maxMetres: values.at(-1) };
}
function fieldProximity(buildings, fields, metresPerUnit) {
  if (!fields.length) return null;
  return quantiles(buildings.map(b => {
    const p = center(b.ring);
    return Math.min(...fields.map(f => pointInPolygon(p, f.ring) ? 0
      : Math.min(...f.ring.map((a, i) => distance(p, a, f.ring[(i + 1) % f.ring.length]))))) * metresPerUnit;
  }));
}
function farmDistribution(farms, fields, urban) {
  const c = { x: (urban.min_x + urban.max_x) / 2, y: (urban.min_y + urban.max_y) / 2 };
  const fieldReach = Math.max(...fields.flatMap(f => f.ring.map(p => Math.hypot(p.x - c.x, p.y - c.y))));
  const radial = { innerHalf: 0, outerHalf: 0, beyondFieldReach: 0 };
  const sectors = Array(8).fill(0); // Clockwise from east in y-down coordinates.
  for (const f of farms) {
    const p = center(f.ring), r = Math.hypot(p.x - c.x, p.y - c.y) / fieldReach;
    radial[r < .5 ? 'innerHalf' : r <= 1 ? 'outerHalf' : 'beyondFieldReach']++;
    const angle = Math.atan2(p.y - c.y, p.x - c.x);
    sectors[Math.floor(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4))]++;
  }
  return { centre: c, fieldReachUnits: fieldReach, radial, sectorsClockwiseFromEast: sectors };
}
function proximity(buildings, roads, metresPerUnit) {
  if (!buildings.length || !roads.length) return null;
  const values = buildings.map(b => {
    const p = center(b.ring);
    return Math.min(...roads.flatMap(r => r.path.slice(1).map((end, i) => distance(p, r.path[i], end)))) * metresPerUnit;
  });
  return quantiles(values);
}
function artworkScaleReview(symbols, metresPerUnit) {
  const dimensions = s => {
    const ink = engine.ARTWORK_INK[s.id];
    if (!ink) return null;
    return [(ink.bounds[2]-ink.bounds[0])*s.scale/64, (ink.bounds[3]-ink.bounds[1])*(s.scaleY??s.scale)/64];
  };
  const homes = symbols.filter(s => s.buildingId && /house|tenement/.test(s.id)
    && !engine.ARTWORK_MANIFEST[s.id]?.courtyardVoids?.length && dimensions(s));
  const nearby = s => {
    const owned = new Set(linkedBuildingIds(s));
    const nearest = homes.filter(h => h!==s && !linkedBuildingIds(h).some(id=>owned.has(id))).map(h => ({h,distance:Math.hypot(h.at.x-s.at.x,h.at.y-s.at.y)}))
      .sort((a,b)=>a.distance-b.distance).slice(0,5);
    const widths = nearest.map(({h})=>Math.min(...dimensions(h))*metresPerUnit).sort((a,b)=>a-b);
    return { nearbyHomeIds: nearest.map(({h})=>h.buildingId), nearbyHomePaintedShortSideMedianMetres: widths[Math.floor(widths.length/2)]??null };
  };
  const wells = [], courtyards = [];
  for (const s of symbols) {
    const meta = engine.ARTWORK_MANIFEST[s.id], size = dimensions(s);
    if (!meta || !size) continue;
    if (/^sm-well(?:--|$)/.test(s.id)) {
      const neighbours = nearby(s), paintedDiameterMetres = Math.max(...size)*metresPerUnit;
      wells.push({id:s.id,at:s.at,...neighbours,paintedDiameterMetres,
        diameterToNearbyHomeWidth: neighbours.nearbyHomePaintedShortSideMedianMetres ? paintedDiameterMetres/neighbours.nearbyHomePaintedShortSideMedianMetres : null});
    }
    if (meta.courtyardVoids?.length && meta.footprintPolygons?.length) {
      // Catalogue components are authored as axis-aligned roof polygons. The
      // short local bounding-box side measures wing thickness, not site size.
      const componentRoofWidthsMetres = meta.footprintPolygons.map(poly=>{
        const xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]);
        return Math.min((Math.max(...xs)-Math.min(...xs))*s.scale/64,
          (Math.max(...ys)-Math.min(...ys))*(s.scaleY??s.scale)/64)*metresPerUnit;
      });
      const neighbours = nearby(s), minimumComponentRoofWidthMetres = Math.min(...componentRoofWidthsMetres);
      courtyards.push({id:s.id,buildingId:s.buildingId,buildingIds:linkedBuildingIds(s),at:s.at,...neighbours,componentRoofWidthsMetres,minimumComponentRoofWidthMetres,
        componentToNearbyHomeWidth: neighbours.nearbyHomePaintedShortSideMedianMetres ? minimumComponentRoofWidthMetres/neighbours.nearbyHomePaintedShortSideMedianMetres : null});
    }
  }
  return { measurement:'guarded painted bounds for wells/houses; authored component bounds for courtyard wings; legacy metres remain estimated', wells,courtyards };
}
const reports = [];
for (const fixture of fixtures) {
  const parsed = await engine.parseSettlementUrl(new URLSearchParams(fixture.query));
  const options = { seed: parsed.seedOverride, ...(fixture.development ? { development: fixture.development } : {}) };
  const session = engine.createSettlementSession(parsed.burg, options);
  const scene = session.scene;
  if (!scene) throw new Error('Review fixtures require scene geometry');
  const L = scene.layers, farms = L.buildings.filter(b => b.kind === 'farm');
  if (!frames[fixture.id]) {
    const urban = pad(bounds(L.walls.flatMap(w => w.polylines.flat())));
    const w = urban.max_x - urban.min_x, h = urban.max_y - urban.min_y;
    frames[fixture.id] = {
      overview: { bounds: scene.bounds, detail: 'auto' },
      urban: { bounds: urban, detail: 'full' },
      detail: { bounds: { min_x: urban.min_x + w * .3, max_x: urban.min_x + w * .74, min_y: urban.min_y + h * .08, max_y: urban.min_y + h * .52 }, detail: 'full' },
    };
    if (fixture.id === 'rural') {
      const north = farms.reduce((a, b) => bounds(a.ring).min_y < bounds(b.ring).min_y ? a : b);
      const p = center(north.ring), radius = 220;
      frames[fixture.id].farm = { bounds: { min_x: p.x - radius, max_x: p.x + radius, min_y: p.y - radius, max_y: p.y + radius }, detail: 'full' };
    }
  }
  if (fixture.id === 'rural') {
    // Keep the original geographic crop above (so relocated rows disappear),
    // and inspect a current holding at the same 440 m width. This extra crop
    // follows the current northernmost farm; its bounds are explicit in JSON.
    const north = farms.reduce((a, b) => bounds(a.ring).min_y < bounds(b.ring).min_y ? a : b);
    const p = center(north.ring), radius = 220;
    frames[fixture.id]['farm-current'] = { bounds: { min_x: p.x - radius, max_x: p.x + radius, min_y: p.y - radius, max_y: p.y + radius }, detail: 'full', framing: 'current northernmost farm; fixed 440 metre width' };
  }
  const byKind = {};
  const plain = [];
  const metresPerUnit = scene.metersPerUnit ?? 1;
  for (const b of L.buildings) {
    byKind[b.kind] ??= { total: 0, glyphBacked: 0, plain: 0, areaUnits2: 0, plainAreaUnits2: 0, estimatedAreaM2: 0, estimatedPlainAreaM2: 0 };
    byKind[b.kind].total++; byKind[b.kind][b.glyphBacked ? 'glyphBacked' : 'plain']++;
    const a = area(b.ring);
    byKind[b.kind].areaUnits2 += a;
    byKind[b.kind].estimatedAreaM2 += a * metresPerUnit ** 2;
    if (!b.glyphBacked) {
      byKind[b.kind].plainAreaUnits2 += a;
      byKind[b.kind].estimatedPlainAreaM2 += a * metresPerUnit ** 2;
      plain.push({ id: b.id, kind: b.kind, areaUnits2: a, estimatedAreaM2: a * metresPerUnit ** 2, centre: center(b.ring), bounds: bounds(b.ring) });
    }
  }
  plain.sort((a, b) => b.areaUnits2 - a.areaUnits2);
  if (!frames[fixture.id].filler && plain.length) {
    const urban = frames[fixture.id].urban.bounds, radius = (urban.max_x - urban.min_x) * .2;
    const inside = plain.filter(b => b.centre.x >= urban.min_x && b.centre.x <= urban.max_x && b.centre.y >= urban.min_y && b.centre.y <= urban.max_y);
    // Save the highest-area cluster as a fixed geographic crop for subsequent
    // revisions. IDs may change with geometry; the before frame must not move.
    const scored = inside.map(b => ({ b, score: inside.filter(n => Math.hypot(n.centre.x - b.centre.x, n.centre.y - b.centre.y) < radius).reduce((n, p) => n + p.areaUnits2, 0) }));
    scored.sort((a, b) => b.score - a.score);
    const p = (scored[0]?.b ?? plain[0]).centre;
    frames[fixture.id].filler = { bounds: { min_x: p.x - radius, max_x: p.x + radius, min_y: p.y - radius, max_y: p.y + radius }, detail: 'full', framing: 'fixed highest-area plain-footprint cluster from first review' };
  }
  const residentialKinds = ['craftsmen', 'merchant', 'slum', 'patriciate', 'gate', 'farm'];
  const residential = L.buildings.filter(b => residentialKinds.includes(b.kind) && !b.landmark);
  const symbolCounts = {};
  for (const s of L.symbols) symbolCounts[s.id] = (symbolCounts[s.id] ?? 0) + 1;
  const full = session.renderFull();
  const artworkScale = artworkScaleReview(L.symbols, metresPerUnit);
  for (const [name, entries, score] of [['scale-well',artworkScale.wells,'diameterToNearbyHomeWidth'],['scale-courtyard',artworkScale.courtyards,'componentToNearbyHomeWidth']]) {
    if (!entries.length) continue;
    const selected = [...entries].sort((a,b)=>name==='scale-well' ? b[score]-a[score] : a[score]-b[score])[0];
    const radius = 35/metresPerUnit, p=selected.at;
    frames[fixture.id][name] ??= {bounds:{min_x:p.x-radius,max_x:p.x+radius,min_y:p.y-radius,max_y:p.y+radius},detail:'full',
      framing:'fixed first-review site; 70 metre width (legacy estimated)',focus:selected};
    if (name === 'scale-courtyard') frames[fixture.id][`${name}-current`] = {bounds:{min_x:p.x-radius,max_x:p.x+radius,min_y:p.y-radius,max_y:p.y+radius},detail:'full',
      framing:'current smallest component/home ratio site; fixed 70 metre width (legacy estimated)',focus:selected};
  }
  await writeFile(`${out}/${fixture.id}-full.svg`, full);
  const report = {
    id: fixture.id, query: fixture.query, input: parsed.burg, options,
    coordinateSystem: session.metadata.coordinateSystem, metresPerUnit: session.metadata.metersPerUnit,
    residents: session.metadata.residents ?? null,
    buildings: L.buildings.length, glyphBacked: L.buildings.filter(b => b.glyphBacked).length,
    // Ward-based visual proxy, not an independent occupancy or population count.
    residentialWardFootprints: residential.length, plainResidentialWardFootprints: residential.filter(b => !b.glyphBacked).length,
    byKind, largestPlainFootprints: plain.slice(0, 25),
    plainFootprintAreaUnits2: plain.reduce((n, b) => n + b.areaUnits2, 0),
    estimatedPlainFootprintAreaM2: plain.reduce((n, b) => n + b.estimatedAreaM2, 0),
    symbolCounts, artworkScale, full: uses(full),
    farmCentroidToAnyRoad: proximity(farms, L.roads, scene.metersPerUnit ?? 1),
    farmCentroidToApproach: proximity(farms, L.roads.filter(r => r.role === 'approach' || r.kind === 'road'), scene.metersPerUnit ?? 1),
    farmCentroidToNearestField: fieldProximity(farms, L.fields, scene.metersPerUnit ?? 1),
    farmDistribution: farmDistribution(farms, L.fields, frames[fixture.id].urban.bounds), views: {},
  };
  for (const [name, frame] of Object.entries(frames[fixture.id])) {
    const width = 1400, b = frame.bounds;
    const fullView = session.renderView({ bounds: b, width, detail: 'full' });
    const auto = session.renderView({ bounds: b, width, detail: 'auto' });
    report.views[name] = { ...frame, width, full: uses(fullView), auto: uses(auto) };
    const selected = frame.detail === 'full' ? fullView : auto;
    const svg = resized(selected, b, width);
    await writeFile(`${out}/${fixture.id}-${name}.svg`, svg);
    if (name === 'detail' || name === 'filler') await writeFile(`${out}/${fixture.id}-${name}-auto.svg`, resized(auto, b, width));
    if (png) await sharp(Buffer.from(svg)).png().toFile(`${out}/${fixture.id}-${name}.png`);
  }
  reports.push(report);
  await writeFile(`${out}/metrics.json`, JSON.stringify({ engineUrl, build: engine.BUILD_INFO, reports }, null, 2));
  console.log(`${fixture.id}: ${report.glyphBacked}/${report.buildings} glyph-backed; ${report.plainResidentialWardFootprints}/${report.residentialWardFootprints} plain residential-ward footprints`);
}
await writeFile(`${out}/frames.json`, JSON.stringify(frames, null, 2));
console.log(`Review artifacts: ${out}`);
