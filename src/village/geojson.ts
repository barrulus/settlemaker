/**
 * Ship plan Phase 4 — the village engine's GeoJSON.
 *
 * Every existing consumer (settlemaker.com, the `/fmg` endpoint,
 * settlement-tiler) speaks the old engine's contract: a
 * `layer`-discriminated FeatureCollection with a metadata block they gate
 * ingestion on. This is the village's side of it, using the SAME schema
 * version and the same property names wherever the two engines describe the
 * same thing, so a consumer needs no new branch to read a village.
 *
 * Two deliberate differences from `output/geojson-builder.ts`, both
 * documented at their call sites below: ids come from the MODEL rather than
 * an allocator (the village's are content-derived and stable across
 * regeneration — the R-series invariant, which an allocator would destroy),
 * and coordinates are burg-local metres, which is what the village engine
 * has always worked in.
 */
import type { Feature, FeatureCollection } from 'geojson';
import { GEOJSON_SCHEMA_VERSION, SETTLEMAKER_VERSION } from '../output/geojson-builder.js';
import { inkExtent } from './glyphs.js';
import { Point } from '../types/point.js';
import type { Building, VillageModel } from './types.js';

type Pos = [number, number];

const pt = (p: { x: number; y: number }): Pos => [p.x, p.y];
const ring = (points: Array<{ x: number; y: number }>): Pos[] => {
  const r = points.map(pt);
  if (r.length > 0 && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) {
    r.push(r[0]);
  }
  return r;
};

/** The four rotated ink corners of a seated dwelling — what is painted, and
 * so what a consumer should be given as its footprint. */
function footprintRing(b: Building): Pos[] {
  const ink = inkExtent(b.glyph, b.footprint);
  const hw = ink.width / 2;
  const hd = ink.depth / 2;
  const r = (b.bearingDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const at = (x: number, y: number): Point =>
    new Point(b.position.x + x * c - y * s, b.position.y + x * s + y * c);
  return ring([at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)]);
}

export function generateVillageGeoJson(model: VillageModel): FeatureCollection {
  const features: Feature[] = [];

  // 1. Buildings — the model's own `bld:<lotId>` ids, which are derived from
  //    the lot they stand on and therefore stable across regeneration.
  for (const b of model.buildings) {
    features.push({
      type: 'Feature',
      properties: {
        layer: 'building', building_id: b.id, lot_id: b.lotId,
        glyph: b.glyph, occupancy: b.occupancy, bearing_deg: b.bearingDeg,
      },
      geometry: { type: 'Polygon', coordinates: [footprintRing(b)] },
    });
  }

  // 2. Streets — every lane, with its road class as `streetType` (the old
  //    engine's property name) and, for a trunk, the FMG routes it carries.
  //    `sourceRouteIds` is how a merged road reports the several routes it
  //    stands for (spec 5.5), so a consumer can trace any route FMG sent to
  //    the street it became.
  for (const lane of model.lanes) {
    if (lane.points.length < 2) continue;
    const routeIds = lane.sourceRouteIds ?? [];
    features.push({
      type: 'Feature',
      properties: {
        layer: 'street', street_id: lane.id, streetType: lane.type,
        width_m: lane.widthM,
        ...(routeIds.length > 0 ? { route_ids: routeIds } : {}),
        ...(lane.parentId !== undefined ? { parent_street_id: lane.parentId } : {}),
      },
      geometry: { type: 'LineString', coordinates: lane.points.map(pt) },
    });
  }

  // 3. The green, with how it ended up sitting in its network (Task 7).
  features.push({
    type: 'Feature',
    properties: {
      layer: 'green', shape: model.green.shape, variant: model.green.variant,
      diameter_m: model.green.diameter, bearing_deg: model.green.bearingDeg,
      relation: model.greenRelation,
    },
    geometry: { type: 'Point', coordinates: pt(model.green.centre) },
  });

  // 4. Fields.
  for (const f of model.fields) {
    features.push({
      type: 'Feature',
      properties: {
        layer: 'field', field_id: f.id, glyph: f.glyph,
        furrow_bearing_deg: f.furrowBearingDeg,
      },
      geometry: { type: 'Polygon', coordinates: [ring(f.polygon)] },
    });
  }

  // 5. Water, as the model received it — echoed so a consumer draws the same
  //    coast we clipped the village against.
  model.site.water.forEach((poly, i) => {
    if (poly.length < 3) return;
    features.push({
      type: 'Feature',
      properties: { layer: 'water', water_id: `w${i}` },
      geometry: { type: 'Polygon', coordinates: [ring(poly)] },
    });
  });

  // 6. Where a road crosses water (Phase 3) — marked, not drawn.
  for (const b of model.bridges) {
    features.push({
      type: 'Feature',
      properties: {
        layer: 'crossing', crossing_id: b.id, street_id: b.laneId,
        span_m: b.spanM, bearing_deg: b.bearingDeg, narrow: b.narrow,
      },
      geometry: { type: 'Point', coordinates: pt(b.position) },
    });
  }

  // 7. POIs.
  for (const p of model.pois) {
    features.push({
      type: 'Feature',
      properties: {
        layer: 'poi', poi_id: p.id, kind: p.kind, glyph: p.glyph,
        bearing_deg: p.bearingDeg,
      },
      geometry: { type: 'Point', coordinates: pt(p.position) },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
    // Foreign member, permitted by RFC 7946 section 6.1 — the same place the
    // city builder puts its metadata, so consumers read it identically.
    metadata: {
      schema_version: GEOJSON_SCHEMA_VERSION,
      settlemaker_version: SETTLEMAKER_VERSION,
      settlement_generation_version: 'village',
      coordinate_system: 'burg-local',
      coordinate_units: 'metres',
      generated_at: new Date().toISOString(),
      /** Spec 5.5: every FMG route meets this circle at its exact bearing, so
       * a consumer holding it can align this tile with FMG's route lines. */
      contract_radius_m: model.contractRadiusM,
      green_relation: model.greenRelation,
      diagnostics: model.diagnostics,
    },
  } as FeatureCollection;
}
