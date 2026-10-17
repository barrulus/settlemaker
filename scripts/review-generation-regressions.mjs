/** Reproduce reported generation defects without involving viewer caches or tiles.
 * npm run build && node scripts/review-generation-regressions.mjs --png
 * Compare revisions at identical bounds:
 *   --engine /tmp/baseline.mjs --out /tmp/before
 *   --out /tmp/after --frames /tmp/before/frames.json
 * Use --fixture aldford-capital to review one case. Enclosed-ground coverage
 * uses polygon Boolean accounting; painted roof envelopes are labelled proxies.
 * PNG output is optional; SVGs and JSON are always emitted. Wide rural views
 * intentionally use automatic detail, matching the viewer's scale semantics.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boundsOfPoints } from '../dist/geom/bounds.js';
import { nearestOnSegment } from '../dist/generator/city-frontage.js';
import { pointInPolygon } from '../dist/geom/point-in-polygon.js';
import { Polygon } from '../dist/geom/polygon.js';
import { Point } from '../dist/types/point.js';
import { linkedBuildingIds } from '../dist/scene/symbol-buildings.js';
import { roadCorridor } from '../dist/geom/road-corridor.js';
import polygonClipping from 'polygon-clipping';

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
  { id: 'aldford-capital', query: 'name=Aldford&pop=5000&seed=271401&walls=1&plaza=1&temple=1&capital=1&shanty=1&theme=ancient&roads=330%3Amain%2C117%3Amarket%2C192%3Afootpath%2C278%3Amain&biome=desert' },
  { id: 'aldford-1200', query: 'name=Aldford&pop=1200&seed=353956&walls=1&plaza=1&roads=316%3Alocal%2C146%3Alocal%2C282%3Afootpath' },
  { id: 'aldford', query: 'name=Aldford&pop=3400&seed=60891&walls=1&plaza=1&roads=355%3Atrail%2C135%3Amarket%2C236%3Amarket' },
  { id: 'rural', query: 'name=Rural&pop=10000&seed=2&walls=1', development: { preset: 'city', corePopulation: 5000, ruralPopulation: 1000 } },
];
const fixtureId = argument('--fixture');
if (fixtureId && !fixtures.some(f=>f.id===fixtureId)) throw new Error(`Unknown fixture: ${fixtureId}`);
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
  return { measurement:'guarded painted bounds for wells/houses; authored component bounds for courtyard wings; physical coordinates are metres', wells,courtyards };
}

/** Guarded canopy rectangles are deliberately labelled envelopes, not opaque leaf coverage. */
function parkReview(scene) {
  const unit=scene.metersPerUnit??1, L=scene.layers;
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const polygon=ring=>[ring.map(p=>[Math.round(p.x*1e6)/1e6,Math.round(p.y*1e6)/1e6])];
  const multiArea=polys=>polys.reduce((sum,p)=>sum+area(p[0].map(([x,y])=>({x,y})))-p.slice(1).reduce((n,r)=>n+area(r.map(([x,y])=>({x,y}))),0),0);
  const parks=L.greens.filter(g=>g.purpose==='public'&&g.surface!=='paved').map((g,index)=>{
    const trees=L.vegetation.filter(v=>pointInPolygon(v.at,g.ring)), kinds={}, sizes=[], envelopes=[];
    let unmeasuredTrees=0;
    for(const v of trees){
      kinds[v.kind]=(kinds[v.kind]??0)+1;
      const meta=engine.ARTWORK_MANIFEST[v.kind], ink=engine.ARTWORK_INK[v.kind];
      if(!meta||!ink){unmeasuredTrees++;continue;}
      const [x0,y0,x1,y1]=ink.bounds,[ax,ay]=meta.anchor??[meta.viewBox[2]/2,meta.viewBox[3]/2];
      const theta=v.rotationDeg*Math.PI/180,c=Math.cos(theta),sn=Math.sin(theta);
      const ring=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>{
        const dx=(x-ax)*v.scale/meta.viewBox[2],dy=(y-ay)*v.scale/meta.viewBox[3];
        return {x:v.at.x+dx*c-dy*sn,y:v.at.y+dx*sn+dy*c};
      });
      sizes.push(Math.max((x1-x0)*v.scale/meta.viewBox[2],(y1-y0)*v.scale/meta.viewBox[3])*unit);
      envelopes.push(polygon(ring));
    }
    const parkArea=area(g.ring), union=envelopes.length?polygonClipping.union(envelopes):[];
    const clipped=union.length?polygonClipping.intersection(union,polygon(g.ring)):[];
    const pathPolygons=(g.paths??[]).flatMap(path=>path.slice(1).map((end,i)=>polygon(roadCorridor(path[i],end,g.pathWidth??.7).vertices)));
    const pathUnion=pathPolygons.length?polygonClipping.union(pathPolygons):[];
    return {index,bounds:bounds(g.ring),areaUnits2:parkArea,estimatedAreaM2:parkArea*unit**2,trees:trees.length,kinds,
      paintedCanopyMaximumDimension:quantiles(sizes),unmeasuredTrees,
      canopyEnvelopeFraction:parkArea?multiArea(clipped)/parkArea:null,
      canopyEnvelopePathOverlapAreaUnits2:clipped.length&&pathUnion.length?multiArea(polygonClipping.intersection(clipped,pathUnion)):0,
      pathCount:g.paths?.length??0,pathsHash:hash({paths:g.paths,pathWidth:g.pathWidth}),groundHash:hash(g.ring)};
  });
  return {method:'Public unpaved greens; trees assigned by centre. Union of transformed guarded ink rectangles clipped to park: canopy envelope proxy, not opaque leaf pixels. Legacy metres estimated.',
    buildingCensusHash:hash(L.buildings),parks};
}

/** Exact Boolean accounting of the supplied polygon geometry. Artwork roof
 * polygons are a paint-envelope proxy, never a claim to measured SVG pixels. */
function enclosedGroundReviewAtPrecision(scene, precision) {
  const L=scene.layers, unit=scene.metersPerUnit??1;
  const geometry=points=>[points.map(p=>[Math.round(p.x*precision)/precision,Math.round(p.y*precision)/precision])];
  const polygonArea=p=>area(p[0].map(([x,y])=>({x,y})))-p.slice(1).reduce((n,h)=>n+area(h.map(([x,y])=>({x,y}))),0);
  const multiArea=polygons=>polygons.reduce((n,p)=>n+polygonArea(p),0);
  const union=polygons=>polygons.length ? polygonClipping.union(polygons) : [];
  const intersect=(a,b)=>a.length&&b.length ? polygonClipping.intersection(a,b) : [];
  const subtract=(a,b)=>a.length&&b.length ? polygonClipping.difference(a,b) : a;
  const outerPaths=L.walls.filter(w=>!w.large).flatMap(w=>w.polylines);
  const closed=outerPaths.filter(p=>p.length>=4&&Math.hypot(p[0].x-p.at(-1).x,p[0].y-p.at(-1).y)<1e-6);
  if (!closed.length || closed.length!==outerPaths.length)
    return {available:false,reason:'No complete closed outer wall ring; open wall paths are not silently closed',closedOuterPaths:closed.length,outerPaths:outerPaths.length};
  const enclosure=union(closed.map(geometry)), wallBounds=bounds(closed.flat());
  const near=points=>{
    if(points.length<3)return false;
    const b=bounds(points);
    return b.max_x>=wallBounds.min_x&&b.min_x<=wallBounds.max_x&&b.max_y>=wallBounds.min_y&&b.min_y<=wallBounds.max_y;
  };
  const water=L.water.polygons ? union(L.water.polygons.map(p=>p.map(r=>geometry(r)[0])))
    : L.water.rings.length ? polygonClipping.xor(...L.water.rings.map(geometry)) : [];
  const land=subtract(enclosure,water), landArea=multiArea(land), enclosureArea=multiArea(enclosure);
  const clipped=polygons=>intersect(union(polygons),land);
  const footprints=clipped(L.buildings.filter(b=>near(b.ring)).map(b=>geometry(b.ring)));
  const roofPolygons=[], paintedIds=new Set();
  let componentSymbols=0,boundsFallbackSymbols=0,unmeasuredBuildingSymbols=0;
  for(const s of L.symbols){
    const ids=linkedBuildingIds(s);
    if(!ids.length)continue;
    const meta=engine.ARTWORK_MANIFEST[s.id],ink=engine.ARTWORK_INK[s.id];
    if(!meta||!ink){unmeasuredBuildingSymbols++;continue;}
    const theta=s.rotationDeg*Math.PI/180,c=Math.cos(theta),sn=Math.sin(theta);
    const transform=([x,y])=>{
      const dx=(x-meta.anchor[0])*s.scale/meta.viewBox[2],dy=(y-meta.anchor[1])*(s.scaleY??s.scale)/meta.viewBox[3];
      return {x:s.at.x+dx*c-dy*sn,y:s.at.y+dx*sn+dy*c};
    };
    const components=meta.footprintPolygons?.length ? meta.footprintPolygons : (()=>{
      const [x0,y0,x1,y1]=ink.bounds;return [[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]];
    })();
    let included=false;
    for(const p of components){const world=p.map(transform);if(near(world)){roofPolygons.push(geometry(world));included=true;}}
    if(included){if(meta.footprintPolygons?.length)componentSymbols++;else boundsFallbackSymbols++;}
    ids.forEach(id=>paintedIds.add(id));
  }
  // Plain fallback roofs remain visible. An unknown/custom building symbol is
  // conservatively represented by its footprint and reported as unmeasured.
  for(const b of L.buildings)if(!paintedIds.has(b.id)&&near(b.ring))roofPolygons.push(geometry(b.ring));
  const roofEnvelope=clipped(roofPolygons),streetPolygons=[];
  let roadsWithoutWidth=0;
  for(const r of L.roads){
    if(!(r.width>0)){roadsWithoutWidth++;continue;}
    for(let i=1;i<r.path.length;i++){
      const corridor=roadCorridor(r.path[i-1],r.path[i],r.width).vertices;
      if(near(corridor))streetPolygons.push(geometry(corridor));
    }
  }
  const streets=clipped(streetPolygons);
  const groups={publicGreen:[],privateGarden:[],naturalGreen:[],civicGreen:[],unclassifiedGreen:[],pavedCivic:[],pavedPrivate:[],pavedOther:[]};
  for(const g of L.greens){
    if(!near(g.ring))continue;
    const key=g.surface==='paved' ? g.purpose==='civic'?'pavedCivic':g.purpose==='private'?'pavedPrivate':'pavedOther'
      : g.purpose==='public'?'publicGreen':g.purpose==='private'?'privateGarden':g.purpose==='natural'?'naturalGreen':g.purpose==='civic'?'civicGreen':'unclassifiedGreen';
    groups[key].push(geometry(g.ring));
  }
  const masks=Object.fromEntries(Object.entries(groups).map(([k,p])=>[k,clipped(p)]));
  const measure=mask=>{const areaUnits2=multiArea(mask);return{areaUnits2,estimatedAreaM2:areaUnits2*unit**2,fractionOfEnclosedLand:landArea?areaUnits2/landArea:null};};
  // Raw claims overlap: private parcel greens may include the building site.
  // A separate precedence partition prevents adding those claims twice.
  const ordered={buildingFootprint:footprints,streetCorridor:streets,pavedCivic:masks.pavedCivic,pavedPrivate:masks.pavedPrivate,pavedOther:masks.pavedOther,
    publicGreen:masks.publicGreen,privateGarden:masks.privateGarden,naturalGreen:masks.naturalGreen,civicGreen:masks.civicGreen,unclassifiedGreen:masks.unclassifiedGreen};
  let residual=land;const partition={};
  for(const [name,mask]of Object.entries(ordered)){partition[name]=measure(intersect(residual,mask));residual=subtract(residual,mask);}
  partition.unclassifiedGround=measure(residual);
  const partitionArea=Object.values(partition).reduce((n,m)=>n+m.areaUnits2,0);
  if(Math.abs(partitionArea-landArea)>Math.max(1e-6,landArea*1e-8))throw new Error('Disjoint ground partition does not conserve enclosed land area');
  return {available:true,method:'Polygon unions/intersections on rounded geometry; outer wall centreline enclosure excludes citadels; land excludes water',coordinateGridUnits:1/precision,
    enclosedAreaUnits2:enclosureArea,enclosedLandAreaUnits2:landArea,enclosedLandEstimatedAreaM2:landArea*unit**2,
    enclosedWaterFraction:enclosureArea?(enclosureArea-landArea)/enclosureArea:0,
    buildingFootprint:measure(footprints),paintedRoofEnvelope:{...measure(roofEnvelope),
      method:'Transformed authored roof component polygons, or guarded ink bounding rectangles where unavailable; plain roofs retained. Excludes shadows, walls and nonbuilding props. Envelope proxy, not raster ink.',
      componentSymbols,boundsFallbackSymbols,unmeasuredBuildingSymbols},
    streetCorridor:{...measure(streets),method:'Union of reserved-width square-ended segment corridors; excludes decorative casing and rounded joins',roadsWithoutWidth},
    rawGreenClaims:Object.fromEntries(Object.entries(masks).map(([k,m])=>[k,measure(m)])),
    groundPartition:partition,partitionPrecedence:Object.keys(ordered),
    residualMeaning:'Unclassified ground includes wall footprint, setbacks and unlabelled open space; it is not a measurement of failed placements'};
}
function enclosedGroundReview(scene) {
  const precisionFailures=[];
  // Coincident corridor intersections can trigger the Boolean library's
  // floating sweep failure. Retry on explicit, progressively coarser grids;
  // report every retry rather than silently dropping a troublesome feature.
  for(const precision of [1e8,1e6,1e4])try{
    return {...enclosedGroundReviewAtPrecision(scene,precision),...(precisionFailures.length?{precisionFailures}:{})};
  }catch(error){precisionFailures.push({coordinateGridUnits:1/precision,error:String(error)});}
  return {available:false,reason:'Polygon Boolean accounting failed at all bounded precision grids',precisionFailures};
}
const reports = [];
for (const fixture of fixtures.filter(f=>!fixtureId||f.id===fixtureId)) {
  const parsed = await engine.parseSettlementUrl(new URLSearchParams(fixture.query));
  const options = { seed: parsed.seedOverride, ...(parsed.paletteName ? {theme:parsed.paletteName} : {}), ...(fixture.development ? { development: fixture.development } : {}) };
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
  const parks = parkReview(scene);
  if (parks.parks.length) {
    const largest=[...parks.parks].sort((a,b)=>b.areaUnits2-a.areaUnits2)[0];
    frames[fixture.id].park ??= {bounds:pad(largest.bounds,.12),detail:'full',framing:'Fixed largest public park from first review',parkIndex:largest.index};
  }
  for (const [name, entries, score] of [['scale-well',artworkScale.wells,'diameterToNearbyHomeWidth'],['scale-courtyard',artworkScale.courtyards,'componentToNearbyHomeWidth']]) {
    if (!entries.length) continue;
    const selected = [...entries].sort((a,b)=>name==='scale-well' ? b[score]-a[score] : a[score]-b[score])[0];
    const radius = 35/metresPerUnit, p=selected.at;
    frames[fixture.id][name] ??= {bounds:{min_x:p.x-radius,max_x:p.x+radius,min_y:p.y-radius,max_y:p.y+radius},detail:'full',
      framing:'fixed first-review site; 70 metre width (physical metres)',focus:selected};
    if (name === 'scale-courtyard') frames[fixture.id][`${name}-current`] = {bounds:{min_x:p.x-radius,max_x:p.x+radius,min_y:p.y-radius,max_y:p.y+radius},detail:'full',
      framing:'current smallest component/home ratio site; fixed 70 metre width (physical metres)',focus:selected};
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
    symbolCounts, artworkScale, parks, enclosedGround:enclosedGroundReview(scene), full: uses(full),
    farmCentroidToAnyRoad: proximity(farms, L.roads, scene.metersPerUnit ?? 1),
    farmCentroidToApproach: proximity(farms, L.roads.filter(r => r.role === 'approach' || r.kind === 'road'), scene.metersPerUnit ?? 1),
    farmCentroidToNearestField: fieldProximity(farms, L.fields, scene.metersPerUnit ?? 1),
    farmDistribution: farmDistribution(farms, L.fields, frames[fixture.id].urban.bounds), views: {},
  };
  for (const [name, frame] of Object.entries(frames[fixture.id])) {
    if (argument('--view') && name!==argument('--view')) continue;
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
