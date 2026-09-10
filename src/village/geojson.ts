import { roadSurfaceClips } from './road-surface.js';
import { roadCrossSection } from './cross-section.js';
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
import { regimeFor } from '../poi/poi-selector.js';
import { Point } from '../types/point.js';
import { inkExtent } from './glyphs.js';
import { isApron, type Building, type VillageModel } from './types.js';

type Pos = [number, number];

const pt = (p: { x: number; y: number; }): Pos => [p.x, p.y];
const ring = (points: Array<{ x: number; y: number; }>): Pos[] => {
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

/** AABB of everything that paints ink, plus a 20 m pad. This measures the
 * VILLAGE -- its own extent, for `diameterM` alone -- and is deliberately
 * NOT what `local_bounds` publishes: that is `model.frame`, the drawn tile
 * (spec §10.1, owner ruling 2026-09-07). The two are different questions:
 * this one asks how big the settlement is, `local_bounds` asks how far the
 * image extends. */
function inkBounds(model: VillageModel): {
  min_x: number; min_y: number; max_x: number; max_y: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];
  const take = (p: { x: number; y: number; }): void => { xs.push(p.x); ys.push(p.y); };
  for (const b of model.buildings) take(b.position);
  // An apron is CLIPPED to the tile edge (`clipApronsToFrame`), so counting
  // its points would make "the village's own extent" measure the tile
  // instead -- the seventh `isApron` exclusion site alongside the six
  // fabric-measurement ones in `village-model.ts`/`frame.ts`.
  for (const l of model.lanes) {
    if (isApron(l.id)) continue;
    for (const p of l.points) take(p);
  }
  for (const f of model.fields) for (const p of f.polygon) take(p);
  for (const v of model.vegetation) take(v.position);
  take(model.green.centre);
  if (xs.length === 0) return { min_x: 0, min_y: 0, max_x: 0, max_y: 0 };
  const PAD = 20;
  return {
    min_x: Math.min(...xs) - PAD, min_y: Math.min(...ys) - PAD,
    max_x: Math.max(...xs) + PAD, max_y: Math.max(...ys) + PAD,
  };
}

/** The village's overall extent in metres — its own diameter, measured, not
 * predicted from population. */
function diameterM(model: VillageModel): number {
  const b = inkBounds(model);
  return Math.max(b.max_x - b.min_x, b.max_y - b.min_y);
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
  const surfaceClips = roadSurfaceClips(model.lanes);
  for (const lane of model.lanes) {
    if (lane.points.length < 2) continue;
    const routeIds = lane.sourceRouteIds ?? [];
    features.push({
      type: 'Feature',
      properties: {
        layer: 'street', street_id: lane.id, streetType: lane.type,
        width_m: lane.widthM,
        surface_width_m: roadCrossSection(lane).surfaceM,
        ...(lane.routeRole ? { route_role: lane.routeRole } : {}),
        ...(surfaceClips.has(lane.id) ? { surface_clip_m: surfaceClips.get(lane.id)!.map(pt) } : {}),
        setback_m: roadCrossSection(lane).setbackM,
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
      ...(model.green.outline ? { outline_m: model.green.outline.map(pt) } : {}),
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

  // 7. Junctions — where the trunk network's roads meet (spec 5.5). The
  //    model has carried these since Task 5 and `types.ts` promised this
  //    export; it was never written. `pruneJunctions` guarantees each one
  //    sits on a road that actually shipped and names only lanes that still
  //    exist, so a consumer never receives a junction in open ground.
  for (const j of model.trunkJunctions) {
    features.push({
      type: 'Feature',
      properties: { layer: 'junction', junction_id: j.id, street_ids: j.laneIds },
      geometry: { type: 'Point', coordinates: pt(j.position) },
    });
  }

  // 8. POIs.
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
      coordinate_system: 'burg_local_y_down',
      coordinate_units: 'metres',
      generated_at: new Date().toISOString(),
      // Phase 5 parity: every key the SETTLEMENT path publishes also appears
      // here, or a consumer that reads one engine's output crashes on the
      // other's. Values are the village's own honest answers, not stubs.
      //
      // Spec §10.1 (owner ruling 2026-09-07): `local_bounds` is THE DRAWN
      // TILE -- the same rectangle the SVG viewBox covers -- not a box drawn
      // round the lanes. The model owns the frame precisely because the
      // approach roads are clipped to it, so this is the one honest answer
      // to "how far does this image extend". `diameterM` still asks the
      // different question of how big the VILLAGE is, and still uses
      // `inkBounds` for it.
      local_bounds: {
        min_x: model.frame.minX, min_y: model.frame.minY,
        max_x: model.frame.maxX, max_y: model.frame.maxY,
      },
      scale: {
        // The village engine works in metres throughout, so there is no unit
        // conversion to describe -- unlike the settlement path, whose local
        // units are scaled from a population heuristic.
        meters_per_unit: 1,
        diameter_meters: diameterM(model),
        diameter_local: diameterM(model),
        source: 'village_metres',
      },
      /** The village mints its own content-derived ids rather than allocating
       * them (see the module header), so these are the shapes a consumer will
       * see rather than allocator prefixes. */
      stable_ids: {
        prefixes: {
          building: 'bld:', poi: 'poi:', street: '<lane id>', crossing: 'bridge:',
        },
      },
      poi_density: regimeFor(model.site.population),
      degraded_flags: [],
      /** The settlement path can pre-shift its model to pull a distant coast
       * toward the origin. The village engine never does: it works in
       * burg-local metres with the burg at (0,0) throughout. Reported as an
       * explicit no-shift rather than omitted, so a consumer's shift maths is
       * identical for both engines. */
      local_origin_shift: { dx: 0, dy: 0, source: 'none' },
      /** Spec 5.5: every FMG route meets this circle at its exact bearing, so
       * a consumer holding it can align this tile with FMG's route lines. */
      contract_radius_m: model.contractRadiusM,
      green_relation: model.greenRelation,
      ...(model.green.outline ? { outline_m: model.green.outline.map(pt) } : {}),
      diagnostics: model.diagnostics,
    },
  } as FeatureCollection;
}
