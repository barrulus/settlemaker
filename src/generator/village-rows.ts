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
