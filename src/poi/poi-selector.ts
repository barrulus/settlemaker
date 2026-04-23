import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';
import type { Polygon } from '../geom/polygon.js';
import { Point } from '../types/point.js';
import type { IdAllocator } from '../output/id-allocator.js';
import { WardType } from '../types/interfaces.js';
import type { Poi, PoiKind } from './poi-kinds.js';
import { Harbour } from '../wards/harbour.js';

/**
 * Order buildings by desirability: largest first, tiebreak by shortest distance
 * from building centroid to `reference`. Pure function; does not mutate inputs.
 *
 * The reference point lets callers bias selection toward streets: passing the
 * nearest artery vertex scores buildings near it higher. For burgs without
 * arteries, callers pass `model.center`.
 */
export function scoreBuildings(buildings: Polygon[], reference: Point): Polygon[] {
  const scored = buildings.map(b => {
    const c = b.centroid;
    const dx = c.x - reference.x;
    const dy = c.y - reference.y;
    return { b, area: b.square, dist2: dx * dx + dy * dy };
  });
  scored.sort((x, y) => {
    if (y.area !== x.area) return y.area - x.area; // area desc
    return x.dist2 - y.dist2;                       // distance asc
  });
  return scored.map(s => s.b);
}

/**
 * Reference point for scoring: the artery vertex closest to the burg center,
 * or the burg center itself if no arteries exist (tiny unwalled hamlets may
 * have only approach roads).
 */
export function scoringReference(model: Model): Point {
  if (model.arteries.length === 0) return model.center;
  let best: Point | null = null;
  let bestD2 = Infinity;
  for (const artery of model.arteries) {
    for (const v of artery.vertices) {
      const dx = v.x - model.center.x;
      const dy = v.y - model.center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = v; }
    }
  }
  return best ?? model.center;
}

export type PoiDensity = 'hamlet' | 'town';

/** Split point between hamlet and town regimes, per spec. */
export const HAMLET_REGIME_MAX = 300;

export function regimeFor(population: number): PoiDensity {
  return population < HAMLET_REGIME_MAX ? 'hamlet' : 'town';
}

/**
 * True iff the burg has any ward-bearing patch adjacent to open water or the
 * harbour. Used to gate mill placement in both regimes.
 */
export function isWaterAdjacent(model: Model): boolean {
  return waterAdjacentPatches(model).length > 0;
}

/** Returns patches whose ward is present and borders open water or the harbour. */
export function waterAdjacentPatches(model: Model): Patch[] {
  const out: Patch[] = [];
  for (const patch of model.patches) {
    if (patch.ward === null) continue;
    if (model.harbour === patch) { out.push(patch); continue; }
    let adjacent = false;
    for (const wp of model.waterbody) {
      patch.shape.forEdge((v0, v1) => {
        if (!adjacent && wp.shape.findEdge(v1, v0) !== -1) adjacent = true;
      });
      if (adjacent) break;
    }
    if (adjacent) out.push(patch);
  }
  return out;
}

interface EmitCtx {
  model: Model;
  population: number;
  allocator: IdAllocator;
  buildingIdMap: Map<Polygon, string>;
  usedBuildings: Set<Polygon>;
  pois: Poi[];
}

function allBuildings(model: Model): Array<{ building: Polygon; patch: Patch }> {
  const out: Array<{ building: Polygon; patch: Patch }> = [];
  for (const patch of model.patches) {
    if (!patch.ward) continue;
    for (const b of patch.ward.geometry) out.push({ building: b, patch });
  }
  return out;
}

function buildingsInWards(
  model: Model,
  wardTypes: ReadonlySet<WardType>,
): Array<{ building: Polygon; patch: Patch }> {
  return allBuildings(model).filter(({ patch }) => wardTypes.has(patch.ward!.type));
}

function adoptBest(
  ctx: EmitCtx,
  pool: Array<{ building: Polygon; patch: Patch }>,
  ref: Point,
): { building: Polygon; patch: Patch } | null {
  const available = pool.filter(p => !ctx.usedBuildings.has(p.building));
  if (available.length === 0) return null;
  const ordered = scoreBuildings(available.map(a => a.building), ref);
  const chosen = ordered[0];
  return available.find(a => a.building === chosen) ?? null;
}

function emitAdopted(
  ctx: EmitCtx,
  kind: PoiKind,
  preferredWards: ReadonlySet<WardType>,
  count: number,
  opts: { allowFallback: boolean },
): void {
  const ref = scoringReference(ctx.model);
  for (let i = 0; i < count; i++) {
    let target = adoptBest(ctx, buildingsInWards(ctx.model, preferredWards), ref);
    if (target === null && opts.allowFallback) {
      target = adoptBest(ctx, allBuildings(ctx.model), ref);
    }
    if (target === null) return; // skip remaining counts of this kind
    ctx.usedBuildings.add(target.building);
    ctx.pois.push({
      kind,
      point: target.building.centroid,
      wardType: target.patch.ward!.type,
      buildingId: ctx.buildingIdMap.get(target.building) ?? null,
    });
  }
}

function patchesWithWard(model: Model, type: WardType): Patch[] {
  return model.patches.filter(p => p.ward?.type === type);
}

function emitTown(ctx: EmitCtx): void {
  const P = ctx.population;

  // Tier 1 (adoption-essential), alphabetical within tier:
  //   cathedral, chapel, inn, market, mill, smithy, tavern
  // (`chapel` is hamlet-only; `market` and `cathedral` are 1-per-ward.)

  for (const _ of patchesWithWard(ctx.model, WardType.Cathedral)) {
    emitAdopted(ctx, 'cathedral', new Set([WardType.Cathedral]), 1, { allowFallback: false });
  }

  emitAdopted(ctx, 'inn', new Set([WardType.Merchant]),
    Math.max(1, Math.round(P / 1500)), { allowFallback: true });

  for (const _ of patchesWithWard(ctx.model, WardType.Market)) {
    emitAdopted(ctx, 'market', new Set([WardType.Market]), 1, { allowFallback: false });
  }

  if (isWaterAdjacent(ctx.model)) {
    const wards = new Set(waterAdjacentPatches(ctx.model).map(p => p.ward!.type));
    emitAdopted(ctx, 'mill', wards, 1, { allowFallback: false });
  }

  emitAdopted(ctx, 'smithy', new Set([WardType.Craftsmen]),
    Math.max(1, Math.round(P / 2000)), { allowFallback: true });
  emitAdopted(ctx, 'tavern',
    new Set([WardType.Craftsmen, WardType.Slum, WardType.Harbour]),
    Math.max(2, Math.round(P / 1200)), { allowFallback: true });

  // Tier 2, alphabetical: bathhouse, guardhouse, guildhall, shop, stable, temple
  if (P >= 5000) {
    emitAdopted(ctx, 'bathhouse', new Set([WardType.Merchant, WardType.Patriciate]),
      1, { allowFallback: false });
  }
  // 1 guardhouse per Admin/Military/GateWard ward — collapsed from three loops.
  for (const t of [WardType.Administration, WardType.Military, WardType.GateWard]) {
    for (const _ of patchesWithWard(ctx.model, t)) {
      emitAdopted(ctx, 'guardhouse', new Set([t]), 1, { allowFallback: false });
    }
  }
  for (const _ of patchesWithWard(ctx.model, WardType.Administration)) {
    emitAdopted(ctx, 'guildhall', new Set([WardType.Administration]), 1, { allowFallback: false });
  }
  emitAdopted(ctx, 'shop', new Set([WardType.Merchant, WardType.Market]),
    Math.max(1, Math.round(P / 800)), { allowFallback: true });
  emitAdopted(ctx, 'stable', new Set([WardType.Craftsmen, WardType.GateWard]),
    Math.max(1, Math.round(P / 3000)), { allowFallback: false });
  if (P >= 8000) {
    for (const _ of patchesWithWard(ctx.model, WardType.Patriciate)) {
      emitAdopted(ctx, 'temple', new Set([WardType.Patriciate]), 1, { allowFallback: false });
    }
  }
}

function emitHamlet(ctx: EmitCtx): void {
  const P = ctx.population;
  const ALL: ReadonlySet<WardType> = new Set(Object.values(WardType));

  if (P >= 30) emitAdopted(ctx, 'tavern', ALL, 1, { allowFallback: true });
  if (P >= 50) emitAdopted(ctx, 'chapel', ALL, 1, { allowFallback: true });
  if (P >= 80) emitAdopted(ctx, 'smithy', ALL, 1, { allowFallback: true });
  if (isWaterAdjacent(ctx.model)) {
    emitAdopted(ctx, 'mill', ALL, 1, { allowFallback: true });
  }

  const gateCount = ctx.model.border?.gateMeta.size ?? 0;
  if (P >= 150 && gateCount >= 2) {
    const before = ctx.pois.length;
    emitAdopted(ctx, 'inn', ALL, 1, { allowFallback: true });
    if (ctx.pois.length > before) {
      emitAdopted(ctx, 'stable', ALL, 1, { allowFallback: true });
    }
  }

  if (P >= 30) {
    const point = ctx.model.plaza ? ctx.model.plaza.shape.center : ctx.model.center;
    const wardType = ctx.model.plaza ? ctx.model.plaza.ward?.type ?? null : null;
    ctx.pois.push({ kind: 'well', point, wardType, buildingId: null });
  }
}

/** Midpoint of a pier's outer edge (the edge farthest from the burg center). */
export function pierOuterMidpoint(pier: Polygon, burgCenter: Point): Point {
  // Pier is always a 4-vertex rectangle (see src/wards/harbour.ts#createPiers).
  // Find the edge whose midpoint is farthest from the burg center.
  let best: Point | null = null;
  let bestD2 = -1;
  pier.forEdge((v0, v1) => {
    const mx = (v0.x + v1.x) / 2;
    const my = (v0.y + v1.y) / 2;
    const dx = mx - burgCenter.x;
    const dy = my - burgCenter.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2) { bestD2 = d2; best = new Point(mx, my); }
  });
  return best ?? burgCenter;
}

function emitHarbour(ctx: EmitCtx): void {
  const harbourPatch = ctx.model.harbour;
  if (harbourPatch === null || !(harbourPatch.ward instanceof Harbour)) return;
  const harbour = harbourPatch.ward;

  // Warehouses: top-N by area (nearest-to-pier tiebreak baked into scoreBuildings via pier reference).
  const n = harbour.piers.length >= 3 ? 2 : 1; // `large` harbours get 3+ piers (see createPiers).
  const pierRef = harbour.piers.length > 0
    ? pierOuterMidpoint(harbour.piers[0], ctx.model.center)
    : ctx.model.center;
  const pool = harbourPatch.ward.geometry.map(b => ({ building: b, patch: harbourPatch }));
  for (let i = 0; i < n; i++) {
    const target = adoptBest(ctx, pool, pierRef);
    if (target === null) break;
    ctx.usedBuildings.add(target.building);
    ctx.pois.push({
      kind: 'warehouse',
      point: target.building.centroid,
      wardType: WardType.Harbour,
      buildingId: ctx.buildingIdMap.get(target.building) ?? null,
    });
  }

  // Piers: one POI per pier, point = outer-edge midpoint.
  for (const pier of harbour.piers) {
    ctx.pois.push({
      kind: 'pier',
      point: pierOuterMidpoint(pier, ctx.model.center),
      wardType: WardType.Harbour,
      buildingId: null,
    });
  }
}

export function selectPois(
  model: Model,
  population: number,
  allocator: IdAllocator,
  buildingIdMap: Map<Polygon, string>,
): Poi[] {
  const ctx: EmitCtx = {
    model, population, allocator, buildingIdMap,
    usedBuildings: new Set(),
    pois: [],
  };
  if (regimeFor(population) === 'hamlet') emitHamlet(ctx);
  else emitTown(ctx);
  emitHarbour(ctx);
  return ctx.pois;
}
