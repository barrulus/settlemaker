/**
 * Ship plan Phase 4 — output parity: GeoJSON.
 *
 * The village engine emitted its own SVG and nothing else, while every
 * existing consumer — settlemaker.com, the `/fmg` endpoint,
 * settlement-tiler — expects the old engine's contract. This is the village's
 * side of that contract: the same `layer`-discriminated schema, the same
 * property names where the two engines describe the same thing, and the
 * metadata block consumers gate their ingestion on.
 */
import { describe, expect, it } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { generateVillageGeoJson } from '../../src/village/geojson.js';
import { renderVillage } from '../../src/village/render.js';
import { isApron } from '../../src/village/types.js';
import { GEOJSON_SCHEMA_VERSION } from '../../src/output/geojson-builder.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const flags = {
  port: false, citadel: false, walls: false, plaza: false,
  temple: false, shanty: false, capital: false,
};

const wet: AzgaarBurgInput = {
  name: 'Parity', population: 900, ...flags,
  roadBearings: [
    { bearing_deg: 40, kind: 'main', through: true, route_id: 'r-main' },
    { bearing_deg: 165, kind: 'town', route_id: 'r-town' },
    { bearing_deg: 290, kind: 'trail', route_id: 'r-trail' },
  ],
  coastlineGeometry: [[
    { x: -900, y: 120 }, { x: 900, y: 120 }, { x: 900, y: 900 }, { x: -900, y: 900 },
  ]],
} as AzgaarBurgInput;

const model = generateVillage(wet, 1);
const fc = generateVillageGeoJson(model);
const layer = (name: string) => fc.features.filter((f) => f.properties?.layer === name);
const metadata = (c: typeof fc) => (c as unknown as { metadata: Record<string, any> }).metadata;
const input = wet;

describe('generateVillageGeoJson', () => {
  it('is a FeatureCollection carrying the schema consumers gate on', () => {
    expect(fc.type).toBe('FeatureCollection');
    const meta = (fc as unknown as { metadata: Record<string, unknown> }).metadata;
    expect(meta.schema_version).toBe(GEOJSON_SCHEMA_VERSION);
    expect(meta.coordinate_units).toBe('metres');
    expect(typeof meta.generated_at).toBe('string');
  });

  it('emits every layer the plan names', () => {
    for (const name of ['building', 'street', 'green', 'field', 'water', 'poi']) {
      expect(layer(name).length, `no ${name} features`).toBeGreaterThan(0);
    }
  });

  it('echoes each road\'s class and its FMG route_id on the street it became', () => {
    const streets = layer('street');
    // Every trunk lane says what class of road it is...
    for (const f of streets) expect(typeof f.properties?.streetType).toBe('string');
    // ...and the routes FMG sent are traceable back through the network.
    const echoed = new Set<string>();
    for (const f of streets) {
      for (const id of (f.properties?.route_ids as string[] | undefined) ?? []) echoed.add(id);
    }
    for (const id of ['r-main', 'r-town', 'r-trail']) {
      expect(echoed.has(id), `route ${id} is not echoed on any street`).toBe(true);
    }
  });

  it('uses the model\'s own stable ids, not freshly allocated ones', () => {
    // R-series: village ids are content-derived and survive regeneration, so
    // the export must carry them rather than mint new ones per run.
    const b = layer('building')[0];
    expect(model.buildings.some((x) => x.id === b.properties?.building_id)).toBe(true);
    const s = layer('street')[0];
    expect(model.lanes.some((l) => l.id === s.properties?.street_id)).toBe(true);

    const again = generateVillageGeoJson(generateVillage(wet, 1));
    const ids = (c: typeof fc) => c.features.map((f) => f.properties?.building_id ?? f.properties?.street_id);
    expect(ids(again)).toEqual(ids(fc));
  });

  it('gives every feature a geometry, and every id is unique WITHIN its layer', () => {
    // Per layer, not globally: a crossing carries `street_id` as a FOREIGN
    // KEY naming the road it crosses, which is data a consumer wants and not
    // a second identity. Its own id is `crossing_id`.
    const OWN_ID: Record<string, string> = {
      building: 'building_id', street: 'street_id', field: 'field_id',
      water: 'water_id', crossing: 'crossing_id', poi: 'poi_id',
    };
    const byLayer = new Map<string, string[]>();
    for (const f of fc.features) {
      const l = String(f.properties?.layer);
      expect(f.geometry, `${l} feature has no geometry`).toBeTruthy();
      const key = OWN_ID[l];
      if (!key) continue;
      const id = f.properties?.[key] as string | undefined;
      expect(id, `${l} feature has no ${key}`).toBeTruthy();
      const arr = byLayer.get(l) ?? [];
      arr.push(id!);
      byLayer.set(l, arr);
    }
    for (const [l, ids] of byLayer) {
      expect(new Set(ids).size, `duplicate ids in layer ${l}`).toBe(ids.length);
    }
  });

  it('resolves every reference it hands a consumer', () => {
    const streetIds = new Set(layer('street').map((f) => f.properties?.street_id));
    for (const c of layer('crossing')) {
      expect(streetIds.has(c.properties?.street_id),
        `crossing ${String(c.properties?.crossing_id)} names a street that is not exported`).toBe(true);
    }
    const lotIds = new Set(model.lots.map((l) => l.id));
    for (const b of layer('building')) {
      expect(lotIds.has(b.properties?.lot_id as string),
        `building ${String(b.properties?.building_id)} names a lot that is not in the model`).toBe(true);
    }
  });

  it('carries the contract circle so a consumer can align with FMG\'s routes', () => {
    const meta = (fc as unknown as { metadata: Record<string, unknown> }).metadata;
    expect(meta.contract_radius_m).toBeCloseTo(model.contractRadiusM, 6);
  });
});

describe('local_bounds satisfies the settlemaker viewBox invariant', () => {
  it('spans exactly what the SVG viewBox spans, as cities already do', () => {
    // `tests/entrance-output.test.ts:389` asserts this for the settlement
    // engine and questables' design doc calls it a settlemaker invariant,
    // persisting local_bounds as a jsonb column and fitting its projection
    // to it. The village engine violated it by exactly 40 m in each
    // dimension -- geojson's PAD was 20 against the renderer's 40 -- so a
    // village mis-fitted that projection by 400x its stated tolerance.
    const m = generateVillage(input, 1);
    const svg = renderVillage(m);
    const vb = /viewBox="0 0 ([0-9.]+) ([0-9.]+)"/.exec(svg)!;
    const pxPerMetre = Number(/data-px-per-metre="([0-9.]+)"/.exec(svg)![1]);
    const b = metadata(generateVillageGeoJson(m)).local_bounds;
    // `render.ts`'s `n()` rounds every SVG coordinate to 2 decimal PIXELS
    // before printing the viewBox, so the tightest precision this
    // comparison can honestly hold is that rounding's -- about 0.0025 m at
    // 4 px/m -- not float-exact. `toBeCloseTo(x, 2)` (tolerance 0.005) is
    // already 8000x tighter than the 40 m bug this guards against.
    expect(Number(vb[1]) / pxPerMetre).toBeCloseTo(b.max_x - b.min_x, 2);
    expect(Number(vb[2]) / pxPerMetre).toBeCloseTo(b.max_y - b.min_y, 2);
  });
});

describe('local_bounds is the drawn tile', () => {
  it('matches the model frame exactly, not the box around the lanes', () => {
    const m = generateVillage(input, 1);
    const meta = metadata(generateVillageGeoJson(m));
    expect(meta.local_bounds).toEqual({
      min_x: m.frame.minX, min_y: m.frame.minY,
      max_x: m.frame.maxX, max_y: m.frame.maxY,
    });
  });

  it('contains every lane point, since roads are clipped to the tile', () => {
    const m = generateVillage(input, 1);
    const b = metadata(generateVillageGeoJson(m)).local_bounds;
    for (const lane of m.lanes) {
      for (const p of lane.points) {
        expect(p.x).toBeGreaterThanOrEqual(b.min_x - 0.001);
        expect(p.x).toBeLessThanOrEqual(b.max_x + 0.001);
        expect(p.y).toBeGreaterThanOrEqual(b.min_y - 0.001);
        expect(p.y).toBeLessThanOrEqual(b.max_y + 0.001);
      }
    }
  });

  it('leaves diameter_m measuring the village\'s own ink extent, not the tile', () => {
    // Two different questions: the tile is `frame` (non-apron content plus
    // FRAME_PAD_M=40, with aprons then clipped to it); the diameter is the
    // settlement's OWN extent -- ink AABB (buildings, NON-APRON lane points,
    // field polygons, vegetation, green centre) plus a 20 m pad, per
    // `inkBounds`.
    //
    // Ruling 2026-09-07 (follow-up): `inkBounds` must exclude aprons, the
    // same `isApron` filter used at six other fabric-measurement sites. An
    // apron is clipped exactly onto the tile edge, so counting it would drag
    // "the village's own extent" out to the tile's extent -- which is
    // exactly what was observed before this fix (`diameter_meters` reported
    // LARGER than the tile span, by 15-40 m across several seeds). With
    // aprons excluded, the village is genuinely smaller than the tile that
    // frames it (tile = fabric + 40 m pad), so `toBeLessThan(tileSpan)` is
    // now a real invariant, not a geometry coincidence -- restored below.
    // The independent recomputation of `inkBounds`' own (apron-excluding)
    // formula is kept alongside it: it still catches a regression to reading
    // `model.frame` directly, which the inequality alone would not.
    const m = generateVillage(input, 1);
    const meta = metadata(generateVillageGeoJson(m));
    const tileSpan = Math.max(
      m.frame.maxX - m.frame.minX, m.frame.maxY - m.frame.minY,
    );
    const diameterMeters = (meta.scale as { diameter_meters: number }).diameter_meters;
    expect(diameterMeters).toBeLessThan(tileSpan);

    const xs: number[] = [m.green.centre.x];
    const ys: number[] = [m.green.centre.y];
    const take = (p: { x: number; y: number }): void => { xs.push(p.x); ys.push(p.y); };
    for (const b of m.buildings) take(b.position);
    for (const l of m.lanes) {
      if (isApron(l.id)) continue;
      for (const p of l.points) take(p);
    }
    for (const f of m.fields) for (const p of f.polygon) take(p);
    for (const v of m.vegetation) take(v.position);
    const PAD = 20;
    const expectedDiameter = Math.max(
      (Math.max(...xs) + PAD) - (Math.min(...xs) - PAD),
      (Math.max(...ys) + PAD) - (Math.min(...ys) - PAD),
    );
    expect(diameterMeters).toBeCloseTo(expectedDiameter, 6);
  });
});
