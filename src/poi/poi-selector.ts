import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';
import type { Polygon } from '../geom/polygon.js';
import { Point } from '../types/point.js';
import type { IdAllocator } from '../output/id-allocator.js';
import { WardType } from '../types/interfaces.js';
import type { Poi, PoiKind } from './poi-kinds.js';

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
 * Reference point for scoring: centroid of the nearest artery vertex to the
 * burg center, or the burg center itself if no arteries exist (tiny unwalled
 * hamlets may have only approach roads).
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
    ctx.allocator.alloc('p');
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
    ctx.allocator.alloc('p');
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
  // Town regime + harbour + piers added in later tasks.
  return ctx.pois;
}
