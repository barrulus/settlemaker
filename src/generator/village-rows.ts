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

/**
 * Ribbon-development bound for stampVillageRows: villages are true street
 * villages — rows may ribbon along roads through open (wardless)
 * countryside, not just across already-built ROW_WARDS patches, bounded so
 * ribbons don't sprawl arbitrarily far from the settlement. Passed
 * explicitly (no module-scoped/global state) by callers that want ribbon
 * acceptance; omit it to keep the original built-patches-only behaviour
 * (e.g. every Task 3 unit test still calls `acceptSlot(model, slot)` with
 * no ribbon argument).
 */
export interface RibbonContext {
  /** model.center-relative radius beyond which ribbon probes are rejected. */
  maxBuiltRadius: number;
}

const RIBBON_FACTOR = 1.3;

/**
 * "Open countryside" in this model is not `ward === null` — countryside
 * patches outside the farm belt get `patch.ward = new Ward(this, patch)`
 * (Model.createWards' fallback branch), and the base `Ward` class's `type`
 * field defaults to `WardType.Empty` (see ward.ts). A genuinely null ward
 * (e.g. before wards are assigned at all) is treated the same way, so this
 * covers both.
 */
function isOpenCountryside(patch: Patch): boolean {
  return patch.ward === null || patch.ward.type === WardType.Empty;
}

export function acceptSlot(model: Model, slot: FrontageSlot, ribbon?: RibbonContext): Patch | null {
  const rect = slotRect(slot);
  const probes = [...rect.vertices, slot.center];

  let centerPatch: Patch | null = null;
  for (const probe of probes) {
    if (model.isWaterAt(probe)) return null;
    const patch = model.patches.find(p =>
      !model.waterbody.includes(p) && pointInPolygon(probe, p.shape.vertices));
    if (!patch) return null; // outside the mesh entirely

    if (!isOpenCountryside(patch)) {
      const ward = patch.ward!;
      if (!ROW_WARDS.has(ward.type)) return null;
      // Fields and groves stay clear.
      if (ward instanceof Farm) {
        for (const plot of ward.subPlots) {
          if (pointInPolygon(probe, plot)) return null;
        }
      }
      if (ward.type === WardType.Park) return null;
    } else {
      // Open countryside (ward === null, or the base Ward's default
      // WardType.Empty). Only acceptable for ribbon development, and only
      // within the settlement's built radius * 1.3 — see RibbonContext.
      // The centre probe's patch may end up here; callers that materialise
      // a stamp must attribute it to a real ward (see resolveWardPatch).
      if (!ribbon) return null;
      const dx = probe.x - model.center.x, dy = probe.y - model.center.y;
      const limit = ribbon.maxBuiltRadius * RIBBON_FACTOR;
      if (dx * dx + dy * dy > limit * limit) return null;
    }
    if (probe === slot.center) centerPatch = patch;
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

// The row walk's pitch (front/back/third row) is fixed at the largest
// ordinary footprint (6x6) so slotsAlongPolyline's spacing accommodates
// house-large-tiled/longhouse without the walk itself needing to know
// which glyph a slot will get — but that leaves gaps wherever the variety
// picker actually lands on a smaller hut (4.5x4.5), since the pitch never
// shrinks to fit. The packing pass below (HUT_HOUSE, after rows 0-2)
// backfills those gaps at the smaller pitch, forcing huts so it never
// re-opens the oversized-footprint failure mode the pitch was sized to
// avoid.
const BASE_HOUSE = { width: 6, depth: 6 };
const HUT_HOUSE = { width: 4.5, depth: 4.5 };

/**
 * Nearest ROW_WARDS patch to `patch`, by patch-shape centroid distance.
 * Ribbon houses stand on open (wardless) countryside patches, but they
 * still need a real ward to join for census counting, POI adoption, and
 * GeoJSON to keep working — administratively they belong to the village's
 * built wards, so attribute each ribbon stamp to whichever one is nearest.
 * `builtPatches` is always non-empty when this is called (stampVillageRows
 * only enables ribbon mode when at least one ROW_WARDS patch exists).
 */
function resolveWardPatch(patch: Patch, builtPatches: readonly Patch[]): Patch {
  if (!isOpenCountryside(patch)) return patch;
  const c = patch.shape.centroid;
  let best = builtPatches[0];
  let bestD2 = Infinity;
  for (const bp of builtPatches) {
    const bc = bp.shape.centroid;
    const dx = bc.x - c.x, dy = bc.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = bp; }
  }
  return best;
}

/**
 * Build the resized rect for `id`, re-check acceptance, and materialise
 * (ward geometry + glyph-backed marker + PlacedSymbol + claimed site) on
 * success. No rng draws here — id is already chosen. `patch` must already
 * be ward-resolved (see resolveWardPatch) — its `.ward` is never null here.
 */
function materialiseSlot(
  model: Model, patch: Patch, slot: FrontageSlot, id: string, ribbon?: RibbonContext,
): boolean {
  const fp = houseFootprint(id);
  const resized: FrontageSlot = { ...slot, width: fp.width, depth: fp.depth };
  if (!acceptSlot(model, resized, ribbon)) return false;
  const rect = slotRect(resized);
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
  return true;
}

/**
 * Pick a glyph (exactly one rng draw) and materialise it. On acceptance
 * failure — typically a wider resized footprint (longhouse, house-large-
 * tiled) colliding with a neighbouring claim the original BASE-pitch probe
 * didn't — fall back, deterministically and with NO further rng draws, to
 * the plain house for this settlement's roof bias, then to a mud hut.
 * Drop the slot only if the hut also fails.
 */
function pickAndMaterialise(
  model: Model, patch: Patch, slot: FrontageSlot, bias: RoofBias, isRowEnd: boolean,
  ribbon?: RibbonContext,
): boolean {
  const id = pickHouseGlyph(patch.ward!.type, bias, isRowEnd, model.rng);
  if (materialiseSlot(model, patch, slot, id, ribbon)) return true;
  const plainHouse = bias === 'thatch' ? 'sm-house' : 'sm-house-tiled';
  if (materialiseSlot(model, patch, slot, plainHouse, ribbon)) return true;
  if (materialiseSlot(model, patch, slot, 'sm-hut-mud', ribbon)) return true;
  return false;
}

/** Stamp dwelling rows for a !rowHousing settlement. No-op otherwise. */
export function stampVillageRows(model: Model, allowanceBase: number): void {
  if (rowHousing(model.params.population)) return;

  let allowance = allowanceBase - model.countOrdinaryBuildingsPublic();

  const bias = drawRoofBias(model.rng);

  // Ribbon-development bound: villages are true street villages, so rows
  // may ribbon along roads through open countryside past the last built
  // ROW_WARDS patch, not just across built patches. maxBuiltRadius is the
  // farthest any built ROW_WARDS patch reaches from the settlement centre;
  // ribbon probes are allowed out to maxBuiltRadius * 1.3 (see
  // RibbonContext/acceptSlot). Ribbon mode only activates when at least
  // one built ROW_WARDS patch exists — with none, there is no ward to
  // attribute a ribbon stamp to (see resolveWardPatch), so ribbon stays
  // off and acceptSlot falls back to its original built-patches-only rule.
  const builtPatches = model.patches.filter(p =>
    p.ward !== null && !model.waterbody.includes(p) && ROW_WARDS.has(p.ward.type));
  let maxBuiltR2 = 0;
  for (const p of builtPatches) {
    for (const v of p.shape.vertices) {
      const dx = v.x - model.center.x, dy = v.y - model.center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxBuiltR2) maxBuiltR2 = d2;
    }
  }
  const maxBuiltRadius = builtPatches.length > 0 ? Math.sqrt(maxBuiltR2) : 40; // defensive fallback only
  const ribbon: RibbonContext | undefined =
    builtPatches.length > 0 ? { maxBuiltRadius } : undefined;

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
          const patch = acceptSlot(model, slot, ribbon);
          if (!patch) continue;
          accepted.push({ slot, patch });
        }

        for (let i = 0; i < accepted.length && allowance > 0; i++) {
          const { slot, patch } = accepted[i];
          const wardPatch = resolveWardPatch(patch, builtPatches);
          const isRowEnd = i === 0 || i === accepted.length - 1;
          if (pickAndMaterialise(model, wardPatch, slot, bias, isRowEnd, ribbon)) allowance--;
        }
      }
    }
  }

  // Packing pass: rows 0-2 walk at BASE_HOUSE (6x6) pitch, which leaves
  // gaps wherever the picked glyph came out smaller (huts, 4.5x4.5) — this
  // pass backfills those gaps at hut pitch over arteries+streets (not the
  // outward `roads`, matching the well-site scan's asymmetry), forcing
  // huts via isRowEnd=true so it never re-triggers the oversized-footprint
  // failures the fallback chain above exists for.
  if (allowance > 0) {
    const packingRoads: Array<{ v: ReadonlyArray<Point>; hw: number }> = [
      ...model.arteries.map(a => ({ v: a.vertices, hw: MAIN_STREET / 2 })),
      ...model.streets.map(s => ({ v: s.vertices, hw: REGULAR_STREET / 2 })),
    ];
    for (const road of packingRoads) {
      if (allowance <= 0) break;
      for (const side of [1, -1] as const) {
        if (allowance <= 0) break;
        const slots = slotsAlongPolyline(road.v, side, road.hw, HUT_HOUSE, model.rng, 0, 0);

        const accepted: Array<{ slot: FrontageSlot; patch: Patch }> = [];
        for (const slot of slots) {
          if (allowance <= 0) break;
          const patch = acceptSlot(model, slot, ribbon);
          if (!patch) continue;
          accepted.push({ slot, patch });
        }

        for (let i = 0; i < accepted.length && allowance > 0; i++) {
          const { slot, patch } = accepted[i];
          const wardPatch = resolveWardPatch(patch, builtPatches);
          const id = pickHouseGlyph(wardPatch.ward!.type, bias, true, model.rng);
          if (materialiseSlot(model, wardPatch, slot, id, ribbon)) allowance--;
        }
      }
    }
  }
}
