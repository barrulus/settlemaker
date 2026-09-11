import type { WaterContextResult } from '../input/water-context.js';
import { Point } from '../types/point.js';
import type { RouteType } from './route-class.js';
// Type-only: erased at compile time, so this does not create a runtime
// import cycle even though trunks.ts imports Lane/Site/SiteRoute from here.
import type { TrunkJunction } from './skeleton/trunks.js';
import type { GreenRelation } from './skeleton/green-siting.js';

export type GreenShape =
  | 'sm-green-round' | 'sm-green-lens' | 'sm-green-lens-long'
  | 'sm-green-triangle' | 'sm-green-square' | 'sm-green-d';

/** An FMG route arriving at the burg. Bearings are degrees, 0 = N, clockwise. */
export interface SiteRoute {
  bearingDeg: number;
  type: RouteType;
  through: boolean;
  routeId?: string;
  followsRiver?: boolean;
  relief?: 'descent' | 'ascent' | 'valley' | 'ridge' | 'flat';
}

/** Pass 1 output. Everything in metres, origin at the burg centre. */
export interface Site {
  waterContextResult?: WaterContextResult;
  surveyRadiusM?: number;
  population: number;
  biome: string;
  routes: SiteRoute[];
  /** Closed polygons of water in burg-local metres. */
  water: Point[][];
  flags: {
    port: boolean; temple: boolean; trade: boolean; walls: boolean;
    capital?: boolean; citadel?: boolean; plaza?: boolean; shanty?: boolean;
  };
}

export interface Green {
  /** Road-defined corners for a junction green, in world metres. */
  outline?: Point[];
  shape: GreenShape;
  variant: 'a' | 'b';
  centre: Point;
  /** Long-axis diameter in metres. */
  diameter: number;
  /** Long-axis bearing in degrees; 0 for radially symmetric shapes. */
  bearingDeg: number;
}

export interface Lane {
  /** Classification changes at the village edge; required connectivity is separate. */
  routeRole?: 'approach' | 'street' | 'through';
  id: string;
  type: RouteType;
  /** Metres. Ordered from the green outward. */
  points: Point[];
  /** Reserved corridor, including shoulders. Existing consumers retain this meaning. */
  widthM: number;
  /** Explicit travelled surface; absent uses the legacy class-based paint width. */
  surfaceWidthM?: number;
  /** Ground between corridor edge and lot frontage. */
  setbackM?: number;
  parentId?: string;
  /** Supplied route IDs carried by this segment, sorted and deduplicated.
   * Several approaches may share a street; a route can span several streets
   * with different internal classes. Missing IDs use a stable bearing key. */
  sourceRouteIds?: string[];
}

export interface Lot {
  id: string;
  laneId: string;
  /** +1 = right of the lane's direction of travel, -1 = left. */
  side: 1 | -1;
  /** Midpoint of the lot's frontage. */
  front: Point;
  /** Degrees; the inward normal — the direction a dwelling faces. */
  bearingDeg: number;
  frontageM: number;
  depthM: number;
  score: number;
}

/**
 * Boundary treatment for a settlement, per §7.1: held CONSTANT across the
 * whole village (biome + culture pick it once) — a settlement that fenced
 * some plots and hedged others reads as an error. `none` is a legal
 * outcome, more likely for poor/small sites.
 */
export type EdgeStyle = 'hedge' | 'wall' | 'fence' | 'ditch' | 'none';

/** One placed `sm-edge-*` glyph along a plot or field boundary polyline. */
export interface EdgeStamp {
  id: string;
  glyph: string;
  position: Point;
  bearingDeg: number;
}

export interface Building {
  id: string;
  lotId: string;
  glyph: string;
  position: Point;
  bearingDeg: number;
  /** Final footprint in metres, after every size multiplier. */
  footprint: [number, number];
  occupancy: number;
}

/**
 * §5.6: the garden ground behind a BUILT lot. Only a lot with a dwelling
 * seated on it gets one; an empty lot's straggle stays absence.
 *
 * Gate 5 (2026-08-22): a croft is now a CLAIM ONLY -- it is never painted
 * and carries no boundary art. Owner's verdict on the hedged version:
 * "huge private fields, nothing like what you would see in a village --
 * you'd have fields AROUND the village, not INSIDE the village." What the
 * claim still does is keep the vegetation scatter off the ground directly
 * behind each house, which reads as a garden without drawing a fence round
 * it. Ploughed land now lives in the outer ring (see `FieldBlock`).
 */
export interface Croft {
  id: string;
  lotId: string;
  /** 4 corners: near-flank, near-flank, far-flank, far-flank (lot-facing
   * edge first, matching the lot's own claim orientation). */
  polygon: Point[];
  depthM: number;
}

/**
 * §7.2: one PARCEL of the farmed land lying outside the settlement, beyond
 * the open green belt.
 *
 * GATE 8.3 replaced the annular sectors this used to describe with a planar
 * subdivision: a straight-edged polygon cut out of the farmland region by
 * recursive bisection, its orientation taken from the roads and its own
 * long axis rather than from a bearing about the green. The owner's
 * standing complaint was "near perfect circles everywhere"; gate 8.2
 * measured its own ring, found the courses broken and the FRAME still
 * polar, and refused its bar. `furlongId` (was `wedgeId`) groups parcels
 * loosely by sector for reporting only -- nothing about a parcel's shape
 * comes from it, and parcels in one group do NOT share a furrow bearing any
 * more, because a parcel is ploughed along its own length.
 *
 * A parcel is a single pattern-filled polygon and carries no outline of any
 * kind -- the ploughed look is the crop tile's own furrow texture, and the
 * boundaries show as the BAULK inset between neighbours.
 */
export interface FieldBlock {
  id: string;
  furlongId: string;
  glyph: string;
  /** Straight-edged convex polygon, in order round the parcel. */
  polygon: Point[];
  /** The direction the furrows run: the parcel's own long axis, jittered. */
  furrowBearingDeg: number;
  /** The parcel's area in m^2. */
  areaM2: number;
}

/**
 * §7.3: one scattered tree (or clump neighbour). Placed by a deterministic
 * grid scatter over what fields/crofts/lots/lanes/green/water leave open --
 * see `dressing/vegetation.ts`. `id` is `veg:<cellX>x<cellY>` for a cell's
 * own tree, `veg:<cellX>x<cellY>:<j>` for its j-th clump neighbour.
 */
export interface Vegetation {
  id: string;
  glyph: string;
  position: Point;
  /** Per-tree size jitter, VEG_SCALE_MIN..VEG_SCALE_MAX. */
  scale?: number;
}

/**
 * §7.4: a capped, rule-gated placement -- well, stone circle, boathouse --
 * as opposed to the density scatter in `Vegetation`. `id` is one of
 * `poi:well` / `poi:stone-circle` / `poi:boathouse` (each kind is placed at
 * most once per village). `bearingDeg` is the glyph's RENDER bearing (0 for
 * the invariant well/stone-circle; the door-flip convention for the
 * boathouse, matching `dwellings.ts`'s `renderBearingFor`).
 */
export interface Poi {
  id: string;
  kind: 'well' | 'stone-circle' | 'boathouse';
  glyph: string;
  position: Point;
  bearingDeg: number;
  /**
   * Boathouse only: the jetty running from its seaward face out over the
   * water. A boathouse standing wholly on dry land with no way to reach a
   * boat was the owner's report of 2026-09-07 ("no jetty and no boathouse on
   * the water"). `from` is on the building's seaward face, `to` is out in
   * the water; `widthM` is the deck width.
   */
  jetty?: { from: Point; to: Point; widthM: number };
}

/** An exact wet interval with a deck spanning its two banks. */
export interface WaterCrossing {
  /** Bank-to-bank deck including one metre of dry abutment at each end. */
  centreline?: Point[];
  deck?: Point[];
  /** `bridge:<laneId>:<k>`, k counting crossings along that lane. */
  id: string;
  laneId: string;
  /** Midpoint along the wet run. */
  position: Point;
  /** The lane's bearing across the water, for orienting a span. */
  bearingDeg: number;
  /** How much lane is wet, in metres: the span a bridge would need. */
  spanM: number;
  /** False when the wet run is wider than `NARROW_WATER_M` — a road running
   * into real water rather than stepping over a stream, which is a defect
   * to look at rather than a bridge to build. */
  narrow: boolean;
}

/**
 * The drawn tile, in burg-local metres (spec 2026-09-07 §7).
 *
 * The MODEL owns this, not the renderer, because apron lanes are clipped to
 * it: a renderer that re-derived its own bounds from the geometry would move
 * the very edge the roads were cut to. That inversion is what lets a road
 * touch the edge at all -- while lanes drove the bounds and the renderer
 * added a pad, every metre of extension pushed the frame one metre further
 * ahead of the road.
 */
export interface Frame {
  minX: number; minY: number; maxX: number; maxY: number;
}

export interface VillageModel {
  wall?: import('../scene/scene.js').WallFeature;
  site: Site;
  green: Green;
  lanes: Lane[];
  lots: Lot[];
  buildings: Building[];
  /** §7.1: drawn ONCE per village by `dressVillage`, held constant for
   * every boundary consumer (crofts, fields, vegetation, POIs). */
  edgeStyle: EdgeStyle;
  crofts: Croft[];
  fields: FieldBlock[];
  /** Gate 5: EMPTY, and expected to stay so -- no hedge, wall, fence or
   * ditch is drawn on a field any more. Kept on the model, and painted by
   * the renderer, so the edge machinery stays wired for a future design
   * that wants boundary art back. */
  fieldEdges: EdgeStamp[];
  vegetation: Vegetation[];
  pois: Poi[];
  diagnostics: string[];
  /**
   * The contract circle's radius, in burg-local metres (spec 5.1/5.5).
   *
   * CONSUMER CONTRACT (task 10). Every FMG route reaches this circle at its
   * exact bearing, so a consumer holding this number can line our tile up
   * with FMG's own route lines: a route leaving the burg at bearing B is
   * guaranteed to meet our drawing at `(sin B, -cos B) * contractRadiusM`
   * from the burg origin. It is the one part of the boundary contract that
   * cannot be recovered from the drawing itself -- the roads are painted,
   * the circle is not -- which is why `render.ts` also states it on the
   * root SVG element as `data-contract-radius`, and why Phase 4's GeoJSON
   * echoes it.
   *
   * Not a render or tile boundary (ruling 1): it is purely a routing
   * contract, and the fabric is free to sit well inside it.
   */
  contractRadiusM: number;
  /** The drawn tile (spec §7.1). `render.ts` reads this and computes no
   * bounds of its own; aprons are clipped to it. */
  frame: Frame;
  /**
   * Every junction the trunk network resolved to (spec 5.2).
   *
   * CONSUMER CONTRACT (task 10): Phase 4's GeoJSON exports these as the
   * network's junctions. `pruneJunctions` guarantees each one sits on a
   * road that actually shipped and names only lanes that still exist, so a
   * consumer never receives a junction in open ground.
   */
  trunkJunctions: TrunkJunction[];
  /** Task 7: how the green ended up sitting in its network (spec 5.3) --
   * beside a road, astride one, at the end of one, or enclosed by a ring.
   * Recorded so a later pass (and the G2 gate) can read the choice without
   * re-deriving it from geometry. */
  greenRelation: GreenRelation;
  /** Phase 3: every place a lane crosses water. Empty for a dry village. */
  bridges: WaterCrossing[];
}

/** Bearing rounded to whole degrees and wrapped to [0, 360). */
function bearingKey(bearingDeg: number): string {
  const w = ((Math.round(bearingDeg) % 360) + 360) % 360;
  return String(w).padStart(3, '0');
}

export function armLaneId(bearingDeg: number): string {
  return `arm-${bearingKey(bearingDeg)}`;
}

/**
 * An invented lane leaving the green — one the frontage budget added because
 * the census needed somewhere to live, as opposed to an `arm-` lane, which
 * FMG's route data asked for. Separate id spaces so a lane's identity cannot
 * change meaning between regenerations when FMG adds a route at the same
 * bearing (ruling R10).
 */
export function inventedLaneId(bearingDeg: number): string {
  return `lane-${bearingKey(bearingDeg)}`;
}

/** `atFraction` is where along the parent the branch leaves, 0..1. */
export function branchLaneId(parentId: string, atFraction: number): string {
  const pct = String(Math.round(atFraction * 100)).padStart(2, '0');
  return `${parentId}/b${pct}`;
}

/**
 * A trunk's APRON: its continuation past a contract entry, out to the edge
 * of the drawn tile (spec 2026-09-07 §5.1). `/a` joins the `/b` branch and
 * `/c` connector id vocabulary.
 *
 * TWO APRONS PER LANE, because ONE LANE CAN CARRY TWO ENTRIES. `main-street`
 * redraws the best through pair as a single spine running entry -> entry
 * (`applyMainStreet`), so its FIRST point is a contract entry as much as its
 * last is. Keying the id on the trunk alone gave that spine one apron and
 * left the near entry stopping dead on the circle -- the exact defect this
 * spec exists to remove, surviving on one road per `main-street` village.
 *
 * The scheme, and why it is asymmetric:
 *  - `outer` -> `` `${id}/a` ``, the apron off the lane's LAST point. Every
 *    apron the engine drew before through routes were handled is this one,
 *    and it keeps its id byte-for-byte so ids stay stable across the fix.
 *  - `inner` -> `` `${id}/a0` ``, the apron off the lane's point `[0]` --
 *    "the apron at index 0", numbered the way `/b<pct>` numbers branches.
 *
 * `isApron` therefore has to accept a digit suffix, and `resolveCrossings`
 * may still append its own `~x...` to either form.
 *
 * `isTrunk` deliberately still returns true for an apron id. Every one of
 * its call sites asks "is this structural road rather than village-grown
 * frontage?", and an apron is. `isApron` is the narrower question, asked
 * only where an apron must be held back from something a trunk is fed to.
 */
export function apronLaneId(trunkLaneId: string, end: 'outer' | 'inner' = 'outer'): string {
  return `${trunkLaneId}/a${end === 'inner' ? '0' : ''}`;
}

/** True for an apron lane, either end's (`/a`, `/a0`), including one
 * `resolveCrossings` has split (it appends its own `~x...` suffix). */
export function isApron(laneId: string): boolean {
  return /\/a\d*(~|$)/.test(laneId);
}

export function lotId(laneId: string, side: 1 | -1, ordinal: number): string {
  return `${laneId}:${side === 1 ? 'R' : 'L'}${ordinal}`;
}

/**
 * Gate 6.9, THE RE-CUT ID SPACE. `<laneId>:<R|L><n>+r<pass>`.
 *
 * A lot cut by the FIRST pass down a lane keeps the plain `lotId` form, and
 * its ordinal keeps meaning what §2's stable-id invariant says it means:
 * position counted from the green end, so adding fabric further out never
 * renumbers what is already nearer the green.
 *
 * `recutFreedGround` cuts a SECOND (and third) time, into the gaps claim
 * resolution left behind. Those lots cannot borrow the first pass's
 * ordinals -- the whole point is that they sit BETWEEN them -- so they get
 * their own suffixed space, one counter per (lane, side, pass), numbered in
 * arc order from the green end exactly as the first pass is. The suffix
 * makes a re-cut lot identifiable at a glance in a render or a probe, and
 * keeps every id unique without the first pass's ids ever moving.
 */
export const RECUT_ID_SEPARATOR = '+r';

export function recutLotId(
  laneId: string, side: 1 | -1, ordinal: number, pass: number,
): string {
  return `${lotId(laneId, side, ordinal)}${RECUT_ID_SEPARATOR}${pass}`;
}

/**
 * Ordinal spacing between re-cut passes. Claim resolution orders a strip by
 * ordinal and treats ADJACENT ordinals as one pass's business (see
 * `resolveInnerCurves`); giving each re-cut pass a block of its own above
 * every first-pass ordinal keeps that reading true — a re-cut lot is never
 * mistaken for the first-pass neighbour it happens to sit beside.
 */
export const RECUT_ORDINAL_BASE = 1000;

/**
 * The sort key for a lot within its (lane, side) strip: the first pass's
 * ordinals in order, then each re-cut pass's, in arc order within the pass.
 * Parsing the trailing digits alone would read `...:R3+r2` as ordinal 2.
 */
export function lotOrdinal(id: string): number {
  const cut = id.lastIndexOf(RECUT_ID_SEPARATOR);
  if (cut < 0) {
    const m = /(\d+)$/.exec(id);
    return m ? parseInt(m[1], 10) : 0;
  }
  const pass = parseInt(id.slice(cut + RECUT_ID_SEPARATOR.length), 10) || 0;
  const m = /(\d+)$/.exec(id.slice(0, cut));
  return pass * RECUT_ORDINAL_BASE + (m ? parseInt(m[1], 10) : 0);
}

export function buildingId(lotIdValue: string): string {
  return `bld:${lotIdValue}`;
}

/**
 * The stable identity of one FMG route: its `routeId` when it has one,
 * else its bearing rounded to at most 2 decimals so near-duplicate
 * bearings still make distinct keys. Shared by `trunkLaneId` (sanitised
 * further for the lane id namespace) and by trunk merging's
 * `sourceRouteIds` provenance fold (spec 2026-08-25 §5.5) -- a route
 * without an id must still leave a trace when it merges away, or Task 4's
 * "every FMG route appears in exactly one lane's id or sourceRouteIds"
 * invariant silently loses it.
 */
export function routeProvenanceKey(routeId: string | undefined, bearingDeg: number): string {
  return routeId ?? String(Math.round(bearingDeg * 100) / 100);
}

/**
 * The trunk lane id namespace (spec 2026-08-25 §5.1): content-derived from
 * the route's class and id so a trunk's identity survives regeneration.
 * `routeId` is sanitised (`/` -> `_`) so it can never be mistaken for the
 * `/b` branch-suffix `isTrunk` screens for. When a route carries no id
 * (invented or unattributed), the bearing stands in for it, rounded to at
 * most 2 decimals so near-duplicate bearings still make distinct ids.
 */
export function trunkLaneId(
  type: RouteType,
  routeId: string | undefined,
  bearingDeg: number,
  farSide: boolean,
): string {
  const key = routeId ? routeId.replace(/\//g, '_') : routeProvenanceKey(routeId, bearingDeg);
  return `trunk-${type}-${key}${farSide ? '~far' : ''}`;
}
