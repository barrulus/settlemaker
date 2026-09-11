import { cityUrbanity } from './city-character.js';
import { landscapeHash } from '../assets/landscape-placement.js';
import { buildingIds, IdAllocator } from '../output/id-allocator.js';
import { ARTWORK_MANIFEST as REFINED_MANIFEST, ARTWORK_INK as REFINED_INK, cityGlyph } from '../assets/artwork.js';
import { SeededRandom } from '../utils/random.js';
import { frontagesFor, wardFrontages, polygonsOverlap, drySegments, blocksAccess, overlapsWater, type CityFrontage } from './city-frontage.js';
import { scoreBuildings, scoringReference, selectPois } from '../poi/poi-selector.js';
import { Point } from '../types/point.js';
import { WardType } from '../types/interfaces.js';
import { Polygon } from '../geom/polygon.js';
import { resolveGlyphFor } from '../village/deck.js';
import { computeLocalBounds } from './bounds.js';
import { computeSettlementScale } from '../output/settlement-tiler.js';
import type { Model } from './model.js';
import type { PlacedSymbol } from './symbols.js';

/** Same estimate as city tiling, with its default 20-unit frame padding.
 * This is the sole conversion for the refined manifest's metre scale floors;
 * fitting and collision remain in city mesh units. It is not a surveyed scale. */
export function cityMetersPerUnit(model: Model): number {
  const b = computeLocalBounds(model);
  return computeSettlementScale(model.params.population).diameterMeters
    / Math.max(b.max_x - b.min_x, b.max_y - b.min_y);
}

/** Fit the painted art, including strokes and doorway, inside the EXISTING
 * building. No lots, alleys, capacity or RNG state are changed. Each candidate
 * keeps one architectural family, with a bounded width/depth adjustment
 * to suit frontage proportions. Inward edge half-planes also reject unsuitable concave lots. */
export function fitCityGlyph(
  building: Polygon, id: string, metersPerUnit: number, frontage?: CityFrontage, minCoverage = 0.5,
): (PlacedSymbol & { paintedArea: number }) | null {
  const meta = REFINED_MANIFEST[id], ink = REFINED_INK[id];
  if (!meta?.footprint || !ink || building.length < 3 || Math.abs(building.square) < 1e-8) return null;
  const [nominalWidth, nominalHeight] = meta.footprint;
  const [x0, y0, x1, y1] = ink.bounds;
  const c = building.centroid, winding = Math.sign(building.square);
  let longest = 0, angle = 0;
  building.forEdge((a, b) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > longest) { longest = d; angle = Math.atan2(b.y - a.y, b.x - a.x); }
  });
  let best: (PlacedSymbol & { paintedArea: number }) | null = null;
  if (frontage) {
    angle = Math.atan2(frontage.b.y - frontage.a.y, frontage.b.x - frontage.a.x);
    // The village artwork's entrance faces local south (+y).
    if (-Math.sin(angle) * (frontage.at.x - c.x) + Math.cos(angle) * (frontage.at.y - c.y) < 0) angle += Math.PI;
  }
  for (const rotation of frontage ? [angle] : [angle, angle + Math.PI / 2]) {
    const ax = Math.cos(rotation), ay = Math.sin(rotation);
    const hasCourt = (meta.courtyardVoids?.length ?? 0) > 0 || (meta.footprintPolygons?.length ?? 0) > 1;
    for (const aspect of hasCourt ? [1] : [1, 0.8, 1.25, 0.67, 1.5]) {
      const fw = nominalWidth * aspect, fh = nominalHeight / aspect;
      const iw = (x1 - x0) * fw / 64, ih = (y1 - y0) * fh / 64;
      let factor = Infinity;
      building.forEdge((a, b) => {
        const ex = b.x - a.x, ey = b.y - a.y, length = Math.hypot(ex, ey);
        if (length < 1e-8) return;
        const distance = winding * (ex * (c.y - a.y) - ey * (c.x - a.x)) / length;
        const projection = (Math.abs(ex * ay - ey * ax) * iw + Math.abs(ex * ax + ey * ay) * ih) / (2 * length);
        factor = Math.min(factor, (distance - 0.002) / projection);
      });
      if (!Number.isFinite(factor) || factor * Math.min(aspect, 1 / aspect) * metersPerUnit < meta.minScale) continue;
      const paintedArea = ink.area * fw * fh * factor * factor / (64 * 64);
      // A narrow or irregular lot stays a polygon instead of becoming a tiny
      // detached house surrounded by the empty remainder of its city frontage.
      if (paintedArea < Math.abs(building.square) * minCoverage || (best && paintedArea <= best.paintedArea)) continue;
      const dx = ((x0 + x1) / 2 - meta.anchor[0]) * fw / 64 * factor;
      const dy = ((y0 + y1) / 2 - meta.anchor[1]) * fh / 64 * factor;
      best = {
        id, building, ...(frontage ? { frontage } : {}), at: new Point(c.x - dx * ax + dy * ay, c.y - dx * ay - dy * ax),
        scale: fw * factor, scaleY: fh * factor,
        rotationDeg: rotation * 180 / Math.PI, zBand: 'structure', paintedArea,
      };
    }
  }
  return best;
}

/** One ordinary dwelling family per city. Special forms have explicit uses. */
export function cityArchitecture(seed: number, biome = 'temperate') {
  const rng = new SeededRandom(seed ^ 0x43495459);
  const native = (family: string) => cityGlyph(family, biome);
  return {
    home: native(rng.bool(.5) ? 'row-house-a' : 'row-house-b'),
    wealthy: native('corner'), workshop: native('workshop'), poor: native('row-house-a'),
    temple: native(['church','cathedral','temple-hall','temple-court'][Math.floor(rng.float()*4)]),
    palace: native('palace-hall'), palaceWing: native('palace-wing'),
    keep: native('castle-keep'), barracks: native('castle-barracks'), inn: native('inn'),
  };
}

/** Called once after refinement, water rejection and trimming. Re-running is
 * idempotent: retract only our linked replacements, then use surviving lots. */
export function placeCityGlyphs(model: Model): void {
  if (model.params.population <= 1000) return;
  model.symbols = model.symbols.filter(s => !s.building);
  model.glyphBackedBuildings.clear();
  const water = model.getWaterRings();
  for (const patch of model.patches) if (patch.ward) {
    patch.ward.lanes = patch.ward.lanes.flatMap(lane => drySegments(lane.a, lane.b, water)
      .map(([a, b]) => ({ a, b, width: lane.width })));
  }
  const metersPerUnit = cityMetersPerUnit(model);
  const architecture = cityArchitecture(model.params.seed, model.params.biome);
  const templeWard = model.patches.find(p => p.ward?.type === WardType.Cathedral)?.ward;
  if (templeWard && !templeWard.principalBuilding && templeWard.geometry.length) {
    // Reserve one substantial temple inside its own ward; its annexes are
    // ordinary architecture. The old ring subdivision is not several temples.
    const site = templeWard.getCityBlock();
    let placed: ReturnType<typeof fitCityGlyph> = null;
    for (const line of wardFrontages(templeWard)) {
      const frontage = { ...line, at: new Point((line.a.x + line.b.x) / 2, (line.a.y + line.b.y) / 2) };
      const candidate = fitCityGlyph(site, architecture.temple, metersPerUnit, frontage, 0.2);
      if (candidate && (!placed || candidate.paintedArea > placed.paintedArea)) placed = candidate;
    }
    if (placed) {
      const [x0, y0, x1, y1] = REFINED_INK[placed.id].bounds;
      const [cx, cy] = REFINED_MANIFEST[placed.id].anchor;
      const angle = placed.rotationDeg * Math.PI / 180;
      const rect = new Polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
        const dx = (x - cx) * placed!.scale / 64, dy = (y - cy) * placed!.scaleY! / 64;
        return new Point(placed!.at.x + dx * Math.cos(angle) - dy * Math.sin(angle), placed!.at.y + dx * Math.sin(angle) + dy * Math.cos(angle));
      }));
      // Retain annexes only when their geometry is clear of the reserved site.
      if (!overlapsWater(rect, water)) {
        templeWard.geometry = [rect, ...templeWard.geometry.filter(b => !polygonsOverlap(b, rect)
          && (!placed!.frontage || !blocksAccess(rect.centroid, placed!.frontage.at, b)))];
        templeWard.principalBuilding = rect;
        templeWard.principalSymbol = { ...placed, building: rect, wardType: WardType.Cathedral };
      }
    }
  }
  const temple = templeWard?.principalBuilding ?? (templeWard && scoreBuildings(templeWard.geometry, scoringReference(model))[0]);
  const castleWard = model.patches.find(p => p.ward?.type === WardType.Castle)?.ward;
  const keep = castleWard && scoreBuildings(castleWard.geometry, scoringReference(model))[0];
  const ids=buildingIds(model);
  const semantic=new Map(selectPois(model,model.params.population,new IdAllocator(),ids).filter(p=>p.buildingId).map(p=>[p.buildingId!,p.kind]));
  const poiForms:Record<string,string>={inn:'inn',tavern:'shop-house',smithy:'workshop',stable:'workshop',shop:'shop-house',bathhouse:'bathhouse',guildhall:'guildhall',warehouse:'warehouse',guardhouse:'castle-barracks'};
  for (const patch of model.patches) {
    const ward = patch.ward;
    if (!ward || [WardType.Park, WardType.Market, WardType.Water, WardType.Empty].includes(ward.type)) continue;
    const lines = wardFrontages(ward);
    const urbanity=cityUrbanity(model,patch);
    const palacePrincipal = ward.type === WardType.Administration && model.params.capitalNeeded
      ? scoreBuildings(ward.geometry,scoringReference(model)).find(b=>!semantic.has(ids.get(b)??'')) : undefined;
    for (const building of ward.geometry) {
      if (building === ward.principalBuilding && ward.principalSymbol) {
        model.symbols.push(ward.principalSymbol);
        model.glyphBackedBuildings.add(building);
        continue;
      }
      const use=semantic.get(ids.get(building)??'');
      const roll=landscapeHash(Math.round(building.centroid.x*10),Math.round(building.centroid.y*10),model.params.seed);
      const ruralHome=resolveGlyphFor(model.params.biome??'temperate',roll<.5?'sm-house':'sm-house-tiled');
      const home=urbanity<.45 && roll>.25?ruralHome:architecture.home;
      const id = building === temple ? architecture.temple
        : building === keep ? architecture.keep
          : building === palacePrincipal ? architecture.palace
          : use && poiForms[use] ? cityGlyph(poiForms[use],model.params.biome)
          : ward.type === WardType.Slum ? architecture.poor
            : ward.type === WardType.Administration ? (model.params.capitalNeeded ? architecture.palaceWing : cityGlyph('guildhall',model.params.biome))
              : ward.type === WardType.Patriciate ? architecture.wealthy
              : [WardType.Military, WardType.Castle].includes(ward.type) ? architecture.barracks
                : ward.type === WardType.Harbour ? cityGlyph('warehouse',model.params.biome) : home;
      let best: ReturnType<typeof fitCityGlyph> = null;
      const plannedFrontage = ward.buildingFrontages.get(building);
      const candidates = frontagesFor(building, ward, plannedFrontage ? [plannedFrontage] : lines);
      for (const frontage of candidates) {
        const candidate = fitCityGlyph(building, id, metersPerUnit, frontage, use || building === keep || building === palacePrincipal ? .25 : .5);
        if (candidate && (!best || candidate.paintedArea > best.paintedArea)) best = candidate;
      }
      // A fallback footprint remains in tight corners; do not rotate the front
      // door away from its access just to increase the number of glyphs.
      if (!best) continue;
      model.symbols.push({ ...best, wardType: ward.type, materialVariant:roll<.45?0:1+Math.floor((roll-.45)/.55*4) });
      model.glyphBackedBuildings.add(building);
    }
  }
}
