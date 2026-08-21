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
 * §5.6/§7.1: the enclosed garden strip behind a BUILT lot — toft -> croft ->
 * furlong is one continuous depth axis running back from the lane. Only a
 * lot with a dwelling seated on it gets a croft; an empty lot's straggle
 * stays absence, not a croft nobody tends.
 */
export interface Croft {
  id: string;
  lotId: string;
  /** 4 corners: near-flank, near-flank, far-flank, far-flank (lot-facing
   * edge first, matching the lot's own claim orientation). */
  polygon: Point[];
  depthM: number;
  /** The three open sides (two flanks + back) stamped with the settlement
   * edge style; the lot-facing side carries no boundary. */
  boundary: EdgeStamp[];
}

/**
 * §7.2: one furlong strip within a wedge (the angular sector between two
 * adjacent green-attached lanes). `wedgeId` groups strips that share a
 * furrow direction; `id` is `field:<wedgeId>:S<i>`, `i` the strip's ordinal
 * within its wedge (ordinals may skip where a band was clipped away
 * entirely -- same convention as `EdgeStamp` ids in edges.ts).
 *
 * A strip carries NO boundary of its own (fix wave, V2): outlining every
 * 12 m strip turned the render into caterpillar chains of hedge glyphs.
 * Strip separation is carried by the alternating crop tiles; the block's
 * outside edge is stamped once per bundle and lives on
 * `VillageModel.fieldEdges`.
 */
export interface FieldStrip {
  id: string;
  wedgeId: string;
  glyph: string;
  /** Quad corners, already clipped to the wedge sector and field band. */
  polygon: Point[];
  furrowBearingDeg: number;
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
  fields: FieldStrip[];
  /** §7.2/V2: the field system's boundary art -- one stamped perimeter per
   * surviving wedge BLOCK, not per strip. Kept beside `fields` rather than
   * on each strip because the perimeter belongs to the block. */
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

export function buildingId(lotIdValue: string): string {
  return `bld:${lotIdValue}`;
}
