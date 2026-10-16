import { cityUrbanity } from './city-character.js';
import { landscapeHash } from '../assets/landscape-placement.js';
import { buildingIds, IdAllocator } from '../output/id-allocator.js';
import { ARTWORK_MANIFEST as REFINED_MANIFEST, ARTWORK_INK as REFINED_INK, cityGlyph } from '../assets/artwork.js';
import { SeededRandom } from '../utils/random.js';
import { frontagesFor, wardFrontages, polygonsOverlap, drySegments, segmentInside, blocksAccess, overlapsWater, nearestOnSegment, type CityFrontage } from './city-frontage.js';
import { scoreBuildings, scoringReference, selectPois } from '../poi/poi-selector.js';
import { Point } from '../types/point.js';
import { WardType } from '../types/interfaces.js';
import { Polygon } from '../geom/polygon.js';
import { CommonWard } from '../wards/common-ward.js';
import { fitInscribedRectangle } from '../geom/inscribed-rectangle.js';
import { resolveGlyphFor } from '../village/deck.js';
import { computeLocalBounds } from './bounds.js';
import { computeSettlementScale } from '../output/settlement-tiler.js';
import type { Model } from './model.js';
import type { PlacedSymbol } from './symbols.js';

/** Same estimate as city tiling, with its default 20-unit frame padding.
 * This is the sole conversion for the refined manifest's metre scale floors;
 * fitting and collision remain in city mesh units. It is not a surveyed scale. */
export function cityMetersPerUnit(model: Model): number {
  if (model.params.development) return model.params.development.metresPerUnit;
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
  maxPhysicalScale = Infinity,
  maxAspect = 1.5,
  entranceClear?: (entrance: Point, street: Point) => boolean,
  translate = false,
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
  const siteAngle = angle;
  let best: (PlacedSymbol & { paintedArea: number }) | null = null;
  if (frontage) {
    angle = Math.atan2(frontage.b.y - frontage.a.y, frontage.b.x - frontage.a.x);
    // The village artwork's entrance faces local south (+y).
    if (-Math.sin(angle) * (frontage.at.x - c.x) + Math.cos(angle) * (frontage.at.y - c.y) < 0) angle += Math.PI;
  }
  const rotations = frontage ? [angle] : [angle, angle + Math.PI / 2];
  if(frontage)for(let rotation of [siteAngle,siteAngle+Math.PI/2]) {
    if(-Math.sin(rotation)*(frontage.at.x-c.x)+Math.cos(rotation)*(frontage.at.y-c.y)<0)rotation+=Math.PI;
    const delta=Math.abs(Math.atan2(Math.sin(rotation-angle),Math.cos(rotation-angle)));
    // Older civic/military lots need not be parallel to their street. Align
    // to the real rectangular footprint when the doorway still faces its
    // accessible frontage, never to a rear wall or across a neighbour.
    if(delta>1e-7 && delta<=Math.PI/4)rotations.push(rotation);
  }
  for (const rotation of rotations) {
    const ax = Math.cos(rotation), ay = Math.sin(rotation);
    const hasCourt = (meta.courtyardVoids?.length ?? 0) > 0 || (meta.footprintPolygons?.length ?? 0) > 1;
    for (const aspect of hasCourt ? [1] : [1, 0.8, 1.25, 0.67, 1.5].filter(a => Math.max(a,1/a) <= maxAspect)) {
      const fw = nominalWidth * aspect, fh = nominalHeight / aspect;
      const iw = (x1 - x0) * fw / 64, ih = (y1 - y0) * fh / 64;
      let factor = Infinity;
      let center = c;
      building.forEdge((a, b) => {
        const ex = b.x - a.x, ey = b.y - a.y, length = Math.hypot(ex, ey);
        if (length < 1e-8) return;
        const distance = winding * (ex * (c.y - a.y) - ey * (c.x - a.x)) / length;
        const projection = (Math.abs(ex * ay - ey * ax) * iw + Math.abs(ex * ax + ey * ay) * ih) / (2 * length);
        factor = Math.min(factor, (distance - 0.002) / projection);
      });
      const cap = maxPhysicalScale / (metersPerUnit * Math.max(aspect, 1 / aspect));
      factor = Math.min(factor, cap);
      if (translate) {
        const fit = fitInscribedRectangle(building, iw, ih, rotation, cap);
        if (!fit) continue;
        factor = fit.scale;
        center = fit.center;
      }
      if (!Number.isFinite(factor) || factor * Math.min(aspect, 1 / aspect) * metersPerUnit < meta.minScale) continue;
      const paintedArea = ink.area * fw * fh * factor * factor / (64 * 64);
      // A narrow or irregular lot stays a polygon instead of becoming a tiny
      // detached house surrounded by the empty remainder of its city frontage.
      if (paintedArea < Math.abs(building.square) * minCoverage || (best && paintedArea <= best.paintedArea)) continue;
      // Centred parallel fits reuse the centroid access check. Rotation or
      // translation changes the exit, so validate the actual front-door route
      // even when the translated artwork remains parallel to its frontage.
      if(frontage && entranceClear && (translate || Math.abs(Math.sin(rotation-angle))>1e-7)
        && !entranceClear(new Point(center.x-ay*ih*factor/2,center.y+ax*ih*factor/2),frontage.at))continue;
      const dx = ((x0 + x1) / 2 - meta.anchor[0]) * fw / 64 * factor;
      const dy = ((y0 + y1) / 2 - meta.anchor[1]) * fh / 64 * factor;
      best = {
        id, building, ...(frontage ? { frontage } : {}), at: new Point(center.x - dx * ax + dy * ay, center.y - dx * ay - dy * ax),
        scale: fw * factor, scaleY: fh * factor,
        rotationDeg: rotation * 180 / Math.PI, zBand: 'structure', paintedArea,
      };
    }
  }
  return best;
}

/** A coherent row-house family plus the catalogue's single-building dense
 * forms. Aggregate terraces are not interchangeable with one census lot. */
export function cityArchitecture(seed: number, biome = 'temperate') {
  const rng = new SeededRandom(seed ^ 0x43495459);
  const native = (family: string) => cityGlyph(family, biome);
  return {
    home: native(rng.bool(.5) ? 'row-house-a' : 'row-house-b'),
    dense: native('tenement'), court: native('courtyard-u'),
    wealthy: native('corner'), workshop: native('workshop'), poor: native('row-house-a'),
    temple: native(['church','cathedral','temple-hall','temple-court'][Math.floor(rng.float()*4)]),
    palace: native('palace-hall'), palaceWing: native('palace-wing'),
    keep: native('castle-keep'), barracks: native('castle-barracks'), inn: native('inn'),
  };
}

/** Called once after refinement, water rejection and trimming. Re-running is
 * idempotent: retract only our linked replacements, then use surviving lots. */
export function placeCityGlyphs(model: Model): void {
  if (!model.usesCityLayout) return;
  model.symbols = model.symbols.filter(s => !s.building);
  model.glyphBackedBuildings.clear();
  const water = model.getWaterRings();
  for (const patch of model.patches) if (patch.ward) {
    patch.ward.lanes = patch.ward.lanes.flatMap(lane => drySegments(lane.a, lane.b, water)
      .map(([a, b]) => ({ a, b, width: lane.width })));
  }
  const metersPerUnit = cityMetersPerUnit(model);
  for (const patch of model.patches) if (patch.ward instanceof CommonWard) patch.ward.finalizeWellScale(metersPerUnit);
  const architecture = cityArchitecture(model.params.seed, model.params.biome);
  const templeMaxScale = architecture.temple.includes('cathedral') ? 1.75 : 1.25;
  const templeWard = model.patches.find(p => p.ward?.type === WardType.Cathedral)?.ward;
  if (templeWard && !templeWard.principalBuilding && templeWard.geometry.length) {
    // Reserve one substantial temple inside its own ward; its annexes are
    // ordinary architecture. The old ring subdivision is not several temples.
    const site = templeWard.getPublicBuildingSite();
    let placed: ReturnType<typeof fitCityGlyph> = null;
    for (const line of wardFrontages(templeWard)) {
      const frontage = { ...line, at: new Point((line.a.x + line.b.x) / 2, (line.a.y + line.b.y) / 2) };
      // The artwork catalogue's nominal box is in metres. A parish temple
      // may fit within its ward; it must not expand to fill that ward.
      // Both city entry points use this cap. A capped temple may occupy only
      // a small fraction of a large precinct, so no minimum ward coverage applies.
      const candidate = fitCityGlyph(site, architecture.temple, metersPerUnit, frontage, 0, templeMaxScale);
      if (!candidate) continue;
      const rotation = candidate.rotationDeg * Math.PI / 180;
      const front = (REFINED_INK[candidate.id].bounds[3] - REFINED_MANIFEST[candidate.id].anchor[1]) * candidate.scaleY! / 64;
      const toward = -Math.sin(rotation) * (frontage.at.x - candidate.at.x)
        + Math.cos(rotation) * (frontage.at.y - candidate.at.y);
      // A court's lane extension may pass through the temple centre. Such a
      // tangent is not a usable entrance, even when the rectangle itself fits.
      if (toward <= front + 1e-7 || !segmentInside(candidate.at, frontage.at, templeWard.patch.shape)) continue;
      const dry = drySegments(candidate.at, frontage.at, water);
      if (dry.length !== 1 || dry[0][0] !== candidate.at || dry[0][1] !== frontage.at) continue;
      if (!placed || candidate.paintedArea > placed.paintedArea) placed = candidate;
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
  // A single adopted inn is a street house. Multi-wing inn artwork belongs
  // only to a complete planned compound and keeps its separate building IDs.
  const poiForms:Record<string,string>={inn:'shop-house',tavern:'shop-house',smithy:'workshop',stable:'workshop',shop:'shop-house',bathhouse:'bathhouse',guildhall:'guildhall',warehouse:'warehouse',guardhouse:'castle-barracks'};
  for (const patch of model.patches) {
    const ward = patch.ward;
    if (!ward || [WardType.Park, WardType.Water, WardType.Empty].includes(ward.type)
      || (ward.type === WardType.Market && !ward.publicSpace)) continue;
    const lines = wardFrontages(ward);
    const urbanity=cityUrbanity(model,patch);
    const palacePrincipal = ward.type === WardType.Administration && model.params.capitalNeeded
      ? scoreBuildings(ward.geometry,scoringReference(model)).find(b=>!semantic.has(ids.get(b)??'')) : undefined;
    // Compound artwork replaces the actual planned wings as one group.
    // Its scale was earned by reserving a multi-building site before census,
    // never by squeezing the full arrangement onto one surviving house lot.
    const grouped = new Set<Polygon>();
    for (const compound of ward.compounds) {
      if (!compound.buildings.length || !compound.buildings.every(b=>ward.geometry.includes(b))) continue;
      const dry = drySegments(compound.at,compound.frontage.at,water);
      if (overlapsWater(compound.site,water)
        || dry.length!==1 || dry[0][0]!==compound.at || dry[0][1]!==compound.frontage.at
        || !segmentInside(compound.at,compound.frontage.at,ward.patch.shape)
        || ward.geometry.some(b=>!compound.buildings.includes(b) && blocksAccess(compound.at,compound.frontage.at,b))) continue;
      const id = cityGlyph(compound.family,model.params.biome);
      const ink = REFINED_INK[id];
      if (!ink) continue;
      const roll = landscapeHash(Math.round(compound.at.x*10),Math.round(compound.at.y*10),model.params.seed);
      model.symbols.push({id,building:compound.buildings[0],buildings:[...compound.buildings],
        at:compound.at,scale:compound.canvas,scaleY:compound.canvas,rotationDeg:compound.rotationDeg,
        frontage:compound.frontage,zBand:'structure',wardType:ward.type,
        paintedArea:ink.area*compound.canvas**2/(64*64),
        materialVariant:roll<.45?0:1+Math.floor((roll-.45)/.55*4)});
      for (const building of compound.buildings) {
        grouped.add(building);
        model.glyphBackedBuildings.add(building);
      }
    }
    for (const building of ward.geometry) {
      if (grouped.has(building)) continue;
      if (building === ward.principalBuilding && ward.principalSymbol) {
        model.symbols.push(ward.principalSymbol);
        model.glyphBackedBuildings.add(building);
        continue;
      }
      const use=semantic.get(ids.get(building)??'');
      const roll=landscapeHash(Math.round(building.centroid.x*10),Math.round(building.centroid.y*10),model.params.seed);
      const ruralHome=resolveGlyphFor(model.params.biome??'temperate',roll<.5?'sm-house':'sm-house-tiled');
      const detached = model.params.development
        ? roll < Math.max(0, Math.min(.85, (1 - urbanity) * 1.1 - .15))
        : urbanity < .45 && roll > .25;
      const dense = !detached && urbanity >= .7;
      const home: string=detached ? ruralHome : dense && (roll < .8 || Math.abs(building.square)*metersPerUnit*metersPerUnit >= 64)
        ? architecture.dense : architecture.home;
      let corner = false;
      if (ward.type === WardType.Patriciate) {
        const nearby: typeof lines = lines.filter(line=>building.vertices.some(p=>Point.distance(p,nearestOnSegment(p,line.a,line.b))<=line.width/2+.15));
        corner = nearby.some((a,i)=>nearby.slice(i+1).some(b=>{
          const ax=a.b.x-a.a.x, ay=a.b.y-a.a.y, bx=b.b.x-b.a.x, by=b.b.y-b.a.y;
          return Math.abs(ax*by-ay*bx)>Math.hypot(ax,ay)*Math.hypot(bx,by)*.65;
        }));
      }
      const id = building === temple ? architecture.temple
        : building === keep ? architecture.keep
          : building === palacePrincipal ? architecture.palace
          : use && poiForms[use] ? cityGlyph(poiForms[use],model.params.biome)
          : ward.type === WardType.Market ? cityGlyph('shop-house',model.params.biome)
          : ward.type === WardType.Slum ? architecture.poor
            : ward.type === WardType.Administration ? (model.params.capitalNeeded ? architecture.palaceWing : model.params.development ? home : cityGlyph('guildhall',model.params.biome))
              : ward.type === WardType.Patriciate ? (corner ? architecture.wealthy : home)
              : [WardType.Military, WardType.Castle].includes(ward.type) ? architecture.barracks
                : ward.type === WardType.Harbour ? cityGlyph('warehouse',model.params.biome) : home;
      let best: ReturnType<typeof fitCityGlyph> = null;
      const plannedFrontage = ward.buildingFrontages.get(building);
      const candidates = frontagesFor(building, ward, plannedFrontage ? [plannedFrontage] : lines);
      const entranceClear = (entrance: Point, street: Point) => !ward.geometry.some(other=>other!==building && blocksAccess(entrance,street,other));
      const translatedEntranceClear = (entrance: Point, street: Point) => {
        const dry = drySegments(entrance, street, water);
        return dry.length === 1 && dry[0][0] === entrance && dry[0][1] === street
          && segmentInside(entrance, street, ward.patch.shape) && entranceClear(entrance, street);
      };
      const ordinary = !use && building !== temple && building !== keep && building !== palacePrincipal
        && ([WardType.Craftsmen, WardType.Merchant, WardType.Patriciate, WardType.Slum, WardType.GateWard, WardType.Cathedral].includes(ward.type)
          // Non-capital physical administration blocks already select homes.
          // Give those homes the same size-qualified row-house fallback;
          // named civic POIs and capital palace wings retain their own forms.
          || (ward.type === WardType.Administration && !!model.params.development && !model.params.capitalNeeded));
      // The intended architecture must fit its site at a useful real size.
      // A corner house is only for a corner; its failure must not turn an
      // entire wealthy neighbourhood into anonymous polygon roofs.
      const forms = ordinary ? [...new Set([id, ...(dense ? [architecture.dense] : []), detached ? ruralHome : architecture.home])] : [id];
      // First preserve the existing centred family selection. Only a lot
      // with no successful replacement gets the translated recovery pass.
      for (const translate of [false, true]) {
        for (const form of forms) {
          for (const frontage of candidates) {
            const candidate = fitCityGlyph(building, form, metersPerUnit, frontage,
              building === temple ? 0 : use || building === keep || building === palacePrincipal ? .25 : .5,
              building === temple ? templeMaxScale : (model.params.development && !use && building !== keep && building !== palacePrincipal)
                || (ordinary && (form === architecture.dense || form === architecture.court)) ? 1.35 : Infinity,
              model.params.development ? 1.25 : 1.5, translate ? translatedEntranceClear : entranceClear, translate);
            // A courtyard is a site arrangement, not a miniature icon for every
            // inn. Small urban inns occupy street houses; keep their POI identity.
            if (candidate && (model.params.development || ordinary) && REFINED_MANIFEST[form]?.courtyardVoids?.length
              && Math.min(candidate.scale,candidate.scaleY??candidate.scale)*metersPerUnit<12.8) continue;
            // Tenements depict one substantial building. Their eight-metre
            // painted frontage needs a 10.4m nominal canvas, not the catalogue's
            // permissive four-metre icon floor. Courts need wider sites still.
            if (candidate && form === architecture.dense
              && Math.min(candidate.scale,candidate.scaleY??candidate.scale)*metersPerUnit < 10.4) continue;
            if (candidate && (!best || candidate.paintedArea > best.paintedArea)) best = candidate;
          }
          if (best) break;
        }
        if (!best && model.params.development && REFINED_MANIFEST[id]?.courtyardVoids?.length && building!==temple) {
          const compactId = cityGlyph(use==='inn' ? 'shop-house' : 'row-house-a',model.params.biome);
          for (const frontage of candidates) {
            const candidate=fitCityGlyph(building,compactId,metersPerUnit,frontage,.5,1.35,1.25,translate ? translatedEntranceClear : entranceClear,translate);
            if(candidate && (!best || candidate.paintedArea>best.paintedArea))best=candidate;
          }
        }
        if (best) break;
      }
      // A fallback footprint remains in tight corners; never turn the front
      // door away from its access just to increase the number of glyphs.
      if (!best) continue;
      model.symbols.push({ ...best, wardType: ward.type, materialVariant:roll<.45?0:1+Math.floor((roll-.45)/.55*4) });
      model.glyphBackedBuildings.add(building);
    }
  }
}
