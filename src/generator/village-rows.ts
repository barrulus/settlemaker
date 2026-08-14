/**
 * Village rows: dwelling glyphs stamped along road frontages for the
 * !rowHousing regime. Pure helpers here; stampVillageRows orchestrates.
 * Spec: docs/superpowers/specs/2026-08-14-village-rows-design.md
 */
import { Point } from '../types/point.js';
import type { SeededRandom } from '../utils/random.js';
import { Polygon } from '../geom/polygon.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { intersectsSite } from './symbols.js';
import { WardType } from '../types/interfaces.js';
import { Farm } from '../wards/farm.js';
import type { Model } from './model.js';
import type { Patch } from './patch.js';
import { SYMBOL_MANIFEST } from '../assets/symbol-manifest.js';
import { rowHousing } from './generation-params.js';
import { MAIN_STREET, REGULAR_STREET } from '../wards/ward.js';
// `buildingBudget` actually lives in model.ts (not generation-params.js, as
// the brief assumed) — runtime import from here closes a cycle with
// model.ts's `import { stampVillageRows } from './village-rows.js'`. Safe
// under Node ESM because `buildingBudget` is a hoisted function declaration
// used only inside `stampVillageRows`'s body, never at module-init time; see
// task-4-report.md for the verification.
import { buildingBudget } from './model.js';

export interface FrontageSlot {
  center: Point;
  rotationDeg: number;
  width: number;
  depth: number;
}

export function slotsAlongPolyline(
  vertices: ReadonlyArray<Point>,
  side: 1 | -1,
  roadHalfWidth: number,
  house: { width: number; depth: number },
  rng: SeededRandom,
  rowOffset = 0,
  phase = 0,
): FrontageSlot[] {
  const slots: FrontageSlot[] = [];
  if (vertices.length < 2) return slots;

  // Cumulative arclength table.
  const cum: number[] = [0];
  for (let i = 1; i < vertices.length; i++) {
    cum.push(cum[i - 1] + Point.distance(vertices[i - 1], vertices[i]));
  }
  const total = cum[cum.length - 1];

  // Point + unit tangent at arclength s.
  const at = (s: number): { p: Point; tx: number; ty: number } => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / segLen;
    const a = vertices[i - 1], b = vertices[i];
    const tx = (b.x - a.x) / segLen, ty = (b.y - a.y) / segLen;
    return { p: new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), tx, ty };
  };

  let s = phase;
  while (s + house.width <= total) {
    // Fixed draw order per slot: gap, setback, rotation.
    const gap = 0.8 + rng.float() * 0.4;
    const setback = (rng.float() - 0.5) * 0.6;
    const rotJitter = (rng.float() - 0.5) * 8;

    const mid = at(s + house.width / 2);
    const off = roadHalfWidth + house.depth / 2 + rowOffset + setback;
    // Perpendicular: rotate tangent 90° toward `side`.
    const px = -mid.ty * side, py = mid.tx * side;
    slots.push({
      center: new Point(mid.p.x + px * off, mid.p.y + py * off),
      rotationDeg: Math.atan2(mid.ty, mid.tx) * 180 / Math.PI + rotJitter,
      width: house.width,
      depth: house.depth,
    });
    s += house.width + gap;
  }
  return slots;
}

export const ROW_WARDS: ReadonlySet<WardType> = new Set([
  WardType.Craftsmen, WardType.Merchant, WardType.Patriciate,
  WardType.Slum, WardType.GateWard, WardType.Farm,
]);

export function slotRect(slot: FrontageSlot): Polygon {
  const a = slot.rotationDeg * Math.PI / 180;
  const ux = Math.cos(a), uy = Math.sin(a);      // along-road unit
  const vx = -uy, vy = ux;                        // perpendicular unit
  const hw = slot.width / 2, hd = slot.depth / 2;
  const c = slot.center;
  return new Polygon([
    new Point(c.x - ux * hw - vx * hd, c.y - uy * hw - vy * hd),
    new Point(c.x + ux * hw - vx * hd, c.y + uy * hw - vy * hd),
    new Point(c.x + ux * hw + vx * hd, c.y + uy * hw + vy * hd),
    new Point(c.x - ux * hw + vx * hd, c.y - uy * hw + vy * hd),
  ]);
}

export function acceptSlot(model: Model, slot: FrontageSlot): Patch | null {
  const rect = slotRect(slot);
  const probes = [...rect.vertices, slot.center];

  let centerPatch: Patch | null = null;
  for (const probe of probes) {
    if (model.isWaterAt(probe)) return null;
    const patch = model.patches.find(p =>
      p.ward !== null && !model.waterbody.includes(p) && pointInPolygon(probe, p.shape.vertices));
    if (!patch || !ROW_WARDS.has(patch.ward!.type)) return null;
    if (probe === slot.center) centerPatch = patch;
    // Fields and groves stay clear.
    if (patch.ward instanceof Farm) {
      for (const plot of patch.ward.subPlots) {
        if (pointInPolygon(probe, plot)) return null;
      }
    }
    if (patch.ward!.type === WardType.Park) return null;
  }
  if (intersectsSite(rect, model.claimedSites)) return null;
  return centerPatch;
}

export type RoofBias = 'thatch' | 'tile';

export function drawRoofBias(rng: SeededRandom): RoofBias {
  return rng.bool(0.5) ? 'thatch' : 'tile';
}

const HUTS = ['sm-hut-mud', 'sm-hut-round', 'sm-hut-straw'] as const;

export function pickHouseGlyph(
  wardType: WardType, bias: RoofBias, isRowEnd: boolean, rng: SeededRandom,
): string {
  const r = rng.float(); // exactly one draw per call
  if (wardType === WardType.Slum || isRowEnd) return HUTS[Math.min(2, Math.floor(r * 3))];
  if (wardType === WardType.Farm) {
    if (r < 0.15) return 'sm-longhouse';
    return HUTS[Math.min(2, Math.floor(((r - 0.15) / 0.85) * 3))];
  }
  if (wardType === WardType.Merchant || wardType === WardType.Patriciate) {
    if (r < 0.35) return 'sm-house-large-tiled';
    const r2 = (r - 0.35) / 0.65;
    return bias === 'thatch' ? (r2 < 0.75 ? 'sm-house' : 'sm-house-tiled')
                             : (r2 < 0.25 ? 'sm-house' : 'sm-house-tiled');
  }
  return bias === 'thatch' ? (r < 0.75 ? 'sm-house' : 'sm-house-tiled')
                           : (r < 0.25 ? 'sm-house' : 'sm-house-tiled');
}

export function houseFootprint(id: string): { width: number; depth: number } {
  const fp = SYMBOL_MANIFEST[id].footprint ?? [4.5, 4.5];
  return { width: fp[0], depth: fp[1] };
}

const BASE_HOUSE = { width: 6, depth: 6 };

/** Stamp dwelling rows for a !rowHousing settlement. No-op otherwise. */
export function stampVillageRows(model: Model): void {
  if (rowHousing(model.params.population)) return;

  let allowance = buildingBudget(model.params.population, model.params.urbanDensity)
    - model.countOrdinaryBuildingsPublic();

  const bias = drawRoofBias(model.rng);

  // Well reservation: unconditional draw order when wellBudget > 0.
  if (model.wellBudget > 0) {
    let best: Point | null = null;
    let bestD2 = Infinity;
    // Per the brief: only artery/street vertices, not `roads` (the
    // outward approach segments outside the settled frontage).
    const allRoadVertices = [
      ...model.arteries.flatMap(a => a.vertices),
      ...model.streets.flatMap(s => s.vertices),
    ];
    for (const v of allRoadVertices) {
      const dx = v.x - model.center.x, dy = v.y - model.center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = v; }
    }
    if (best) {
      model.claimedSites.push({ at: best, radius: 3.2 });
      model.symbols.push({
        id: 'sm-well',
        at: best,
        scale: 3.2,
        rotationDeg: Math.round(model.rng.float() * 360),
        zBand: 'structure',
        wardType: undefined,
      });
      model.wellBudget--;
    }
  }

  if (allowance <= 0) return;

  const roads: Array<{ v: ReadonlyArray<Point>; hw: number }> = [
    ...model.arteries.map(a => ({ v: a.vertices, hw: MAIN_STREET / 2 })),
    ...model.streets.map(s => ({ v: s.vertices, hw: REGULAR_STREET / 2 })),
    ...model.roads.map(r => ({ v: r.vertices, hw: MAIN_STREET / 2 })),
  ];

  for (let row = 0; row < 3 && allowance > 0; row++) {
    for (const road of roads) {
      if (allowance <= 0) break;
      for (const side of [1, -1] as const) {
        if (allowance <= 0) break;
        const slots = slotsAlongPolyline(
          road.v, side, road.hw, BASE_HOUSE, model.rng, row * 6.5, row * 3,
        );

        // Buffer accepted slots for this road+side+row so row-end status
        // (first/last ACCEPTED slot) can be assigned before materialising.
        const accepted: Array<{ slot: FrontageSlot; patch: Patch }> = [];
        for (const slot of slots) {
          if (allowance <= 0) break;
          const patch = acceptSlot(model, slot);
          if (!patch) continue;
          accepted.push({ slot, patch });
        }

        for (let i = 0; i < accepted.length && allowance > 0; i++) {
          const { slot, patch } = accepted[i];
          const isRowEnd = i === 0 || i === accepted.length - 1;
          const id = pickHouseGlyph(patch.ward!.type, bias, isRowEnd, model.rng);
          const fp = houseFootprint(id);
          const resized: FrontageSlot = { ...slot, width: fp.width, depth: fp.depth };
          const rect = slotRect(resized);
          if (!acceptSlot(model, resized)) continue;

          patch.ward!.geometry.push(rect);
          model.glyphBackedBuildings.add(rect);
          const centre = rect.centroid;
          const scale = Math.max(fp.width, fp.depth);
          model.symbols.push({
            id,
            at: centre,
            scale,
            rotationDeg: slot.rotationDeg,
            zBand: 'structure',
            wardType: patch.ward!.type,
          });
          model.claimedSites.push({ at: centre, radius: scale * 0.55 });
          allowance--;
        }
      }
    }
  }
}
