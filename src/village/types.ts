import { Point } from '../types/point.js';
import type { RouteType } from './route-class.js';

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
  population: number;
  biome: string;
  routes: SiteRoute[];
  /** Closed polygons of water in burg-local metres. */
  water: Point[][];
  flags: { port: boolean; temple: boolean; trade: boolean; walls: boolean };
}

export interface Green {
  shape: GreenShape;
  variant: 'a' | 'b';
  centre: Point;
  /** Long-axis diameter in metres. */
  diameter: number;
  /** Long-axis bearing in degrees; 0 for radially symmetric shapes. */
  bearingDeg: number;
}

export interface Lane {
  id: string;
  type: RouteType;
  /** Metres. Ordered from the green outward. */
  points: Point[];
  widthM: number;
  parentId?: string;
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
 * §7.2: one block of the field RING -- an annular sector of ploughed land
 * lying outside the settlement, beyond the open green belt. `wedgeId` groups
 * the blocks of one wedge (the angular sector between two adjacent
 * green-attached lanes), which share a furrow bearing; `id` is
 * `field:<wedgeId>:S<i>`, `i` the block's ordinal within its wedge.
 *
 * Gate 5 (2026-08-22) replaced the previous 12 m furlong STRIPS, woven
 * through the fabric and outlined in hedge stamps, with these. Owner's
 * verdict on that design: "you'd have fields AROUND the village, not INSIDE
 * the village." A block is a single pattern-filled polygon and carries no
 * outline of any kind -- the ploughed look is the crop tile's own furrow
 * texture.
 */
export interface FieldBlock {
  id: string;
  wedgeId: string;
  glyph: string;
  /** Annular-sector corners: outer arc forward, inner arc back. */
  polygon: Point[];
  furrowBearingDeg: number;
  /** The sector's area in m^2, as sized against the census. */
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
}

export interface VillageModel {
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
