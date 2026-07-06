import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { WardType } from '../types/interfaces.js';
import type { Palette } from '../types/interfaces.js';
import type { Model } from '../generator/model.js';
import type { CurtainWall } from '../generator/curtain-wall.js';
import { computeLocalBounds } from '../generator/bounds.js';
import { Castle } from '../wards/castle.js';
import { Harbour } from '../wards/harbour.js';
import { Farm } from '../wards/farm.js';
import { PALETTES } from './palette.js';
import { themeFrom, type RenderTheme } from './render-theme.js';
import { NO_SHIFT, applyOutputShift, type OriginShift } from '../generator/origin-shift.js';

const NORMAL_STROKE = 0.15;
const THICK_STROKE = 1.8;

/** Shift a single point into the output frame. */
function sc(p: { x: number; y: number }, shift: OriginShift): [number, number] {
  return applyOutputShift(p.x, p.y, shift);
}

function polygonToPath(poly: Polygon, shift: OriginShift): string {
  if (poly.length === 0) return '';
  const [x0, y0] = sc(poly.vertices[0], shift);
  const parts: string[] = [`M${x0.toFixed(2)},${y0.toFixed(2)}`];
  for (let i = 1; i < poly.length; i++) {
    const [xi, yi] = sc(poly.vertices[i], shift);
    parts.push(`L${xi.toFixed(2)},${yi.toFixed(2)}`);
  }
  parts.push('Z');
  return parts.join('');
}

function polylineToPath(points: Point[], shift: OriginShift): string {
  if (points.length === 0) return '';
  const [x0, y0] = sc(points[0], shift);
  const parts: string[] = [`M${x0.toFixed(2)},${y0.toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    const [xi, yi] = sc(points[i], shift);
    parts.push(`L${xi.toFixed(2)},${yi.toFixed(2)}`);
  }
  return parts.join('');
}

export interface SvgOptions {
  palette?: Palette;
  /** Additional padding around the city bounds */
  padding?: number;
  /** Fine-grained overrides applied on top of the palette-derived theme. */
  theme?: Partial<RenderTheme>;
  /**
   * Translation applied to every emitted coordinate. Defaults to
   * `NO_SHIFT`. Set by `generateFromBurg` after its coast-pull
   * computation so the SVG viewport tracks the shifted geometry.
   */
  shift?: OriginShift;
}

/**
 * Generate an SVG string from a generated Model.
 * Port of CityMap.hx rendering logic.
 *
 * Rendering order:
 * 1. Background
 * 2. Roads (double-stroke: thick outline + thin fill)
 * 3. Buildings/patches (ward-type-specific styling)
 * 4. Walls + towers + gates
 */
export function generateSvg(model: Model, options: SvgOptions = {}): string {
  const palette = options.palette ?? PALETTES.default;
  const theme: RenderTheme = { ...themeFrom(palette), ...options.theme };
  const padding = options.padding ?? 20;
  const shift = options.shift ?? NO_SHIFT;
  const bounds = computeLocalBounds(model, padding, shift);
  const viewMinX = bounds.min_x;
  const viewMinY = bounds.min_y;
  const viewWidth = bounds.max_x - bounds.min_x;
  const viewHeight = bounds.max_y - bounds.min_y;

  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewMinX.toFixed(1)} ${viewMinY.toFixed(1)} ${viewWidth.toFixed(1)} ${viewHeight.toFixed(1)}">`);

  // Background — span the full viewBox in user coords. 100%/100% resolves against viewBox
  // width/height but x/y are user coords, so "0,0 + 100%,100%" covers only the +x/+y quadrant
  // when the viewBox starts at negative coords. The data-bg tag lets cropSvgToTile rewrite
  // these coords to match the tile's (square-padded) viewBox.
  paintBackground(parts, bounds, theme);

  // Fields, greens, then water — matches the pass order for tasks 4-5.
  paintFields(parts, model, theme, shift);
  paintGreens(parts, model, theme, shift);
  paintWater(parts, model, theme, shift);

  // Roads
  paintRoads(parts, model, theme, shift);

  // Building shadows, buildings, landmarks
  paintShadows(parts, model, theme, shift);
  paintBuildings(parts, model, theme, shift);
  paintLandmarks(parts, model, theme, shift);

  // Walls
  if (model.wall !== null) {
    renderWall(parts, model.wall, false, theme, shift);
  }
  if (model.citadel !== null && model.citadel.ward instanceof Castle) {
    renderWall(parts, (model.citadel.ward as Castle).wall, true, theme, shift);
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function paintBackground(
  parts: string[],
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number },
  theme: RenderTheme,
): void {
  const w = bounds.max_x - bounds.min_x;
  const h = bounds.max_y - bounds.min_y;
  parts.push(`<rect data-bg="paper" x="${bounds.min_x.toFixed(1)}" y="${bounds.min_y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${theme.paper}"/>`);
}

function paintFields(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  for (const patch of model.patches) {
    if (!(patch.ward instanceof Farm)) continue;
    const farm = patch.ward;
    for (const plot of farm.subPlots) {
      if (plot.length >= 3) {
        parts.push(`<path d="${polygonToPath(new Polygon(plot), shift)}" fill="${theme.fieldFill}" stroke="none"/>`);
      }
    }
    for (const furrow of farm.furrows) {
      const [x1, y1] = sc(furrow.start, shift);
      const [x2, y2] = sc(furrow.end, shift);
      parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${theme.fieldFurrow}" stroke-width="0.15" opacity="0.3"/>`);
    }
  }
}

function paintGreens(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  for (const patch of model.patches) {
    if (!patch.ward || patch.ward.type !== WardType.Park) continue;
    for (const grove of patch.ward.geometry) {
      parts.push(`<path d="${polygonToPath(grove, shift)}" fill="${theme.greenFill}" stroke="none"/>`);
    }
  }
}

function paintWater(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  if (theme.water === null || model.waterbody.length === 0) return;
  // Same-color stroke fills the antialiasing seams between adjacent
  // Voronoi water patches — visually one continuous body, no union math.
  for (const patch of model.waterbody) {
    parts.push(`<path d="${polygonToPath(patch.shape, shift)}" fill="${theme.water}" stroke="${theme.water}" stroke-width="${theme.seamStroke.toFixed(2)}"/>`);
  }
  // Shore stroke: only edges NOT shared between two water patches (identity-
  // based vertex semantics — adjacent patches share Point instances).
  if (theme.waterEdge !== null) {
    for (const [a, b] of outerWaterEdges(model)) {
      const [x1, y1] = sc(a, shift);
      const [x2, y2] = sc(b, shift);
      parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${theme.waterEdge}" stroke-width="${theme.shoreWidth.toFixed(2)}" stroke-linecap="round"/>`);
    }
  }
}

function paintRoads(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  const lanes: Array<{ path: string; width: number }> = [];
  for (const artery of model.arteries) {
    lanes.push({ path: polylineToPath(artery.vertices, shift), width: theme.arteryWidth });
  }
  for (const road of model.roads) {
    lanes.push({ path: polylineToPath(road.vertices, shift), width: theme.roadWidth });
  }
  // Casings first, then cores: cores merge at junctions instead of being
  // overpainted by the next lane's casing.
  for (const lane of lanes) {
    const casing = lane.width + theme.casingDelta * 2;
    parts.push(`<path d="${lane.path}" fill="none" stroke="${theme.roadCasing}" stroke-width="${casing.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const lane of lanes) {
    parts.push(`<path d="${lane.path}" fill="none" stroke="${theme.roadCore}" stroke-width="${lane.width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
}

interface BuildingGroup {
  landmark: boolean;
  strokeWidth: number;
  polys: Polygon[];
}

const LANDMARK_STROKE: Partial<Record<WardType, number>> = {
  [WardType.Castle]: NORMAL_STROKE * 4,
  [WardType.Cathedral]: NORMAL_STROKE * 2,
  [WardType.Market]: NORMAL_STROKE,
};

function collectBuildings(model: Model): BuildingGroup[] {
  const groups: BuildingGroup[] = [];
  for (const patch of model.patches) {
    if (!patch.ward || patch.ward.geometry.length === 0) continue;
    const landmarkStroke = LANDMARK_STROKE[patch.ward.type];
    groups.push({
      landmark: landmarkStroke !== undefined,
      strokeWidth: landmarkStroke ?? NORMAL_STROKE,
      polys: patch.ward.geometry,
    });
  }
  return groups;
}

function paintShadows(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  const groups = collectBuildings(model);
  if (groups.length === 0) return;
  const { dx, dy } = theme.shadowOffset;
  parts.push(`<g transform="translate(${dx.toFixed(2)},${dy.toFixed(2)})" fill="${theme.shadowColor}" opacity="${theme.shadowOpacity.toFixed(2)}">`);
  for (const group of groups) {
    for (const poly of group.polys) {
      parts.push(`<path d="${polygonToPath(poly, shift)}"/>`);
    }
  }
  parts.push('</g>');
}

function paintBuildings(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  for (const group of collectBuildings(model)) {
    if (group.landmark) continue;
    for (const poly of group.polys) {
      parts.push(`<path d="${polygonToPath(poly, shift)}" fill="${theme.buildingFill}" stroke="${theme.buildingStroke}" stroke-width="${group.strokeWidth.toFixed(2)}"/>`);
    }
  }
  // Harbour piers: sit on water, no shadow, slightly heavier stroke.
  for (const patch of model.patches) {
    if (patch.ward instanceof Harbour) {
      for (const pier of patch.ward.piers) {
        parts.push(`<path d="${polygonToPath(pier, shift)}" fill="${theme.buildingFill}" stroke="${theme.buildingStroke}" stroke-width="${(NORMAL_STROKE * 2).toFixed(2)}"/>`);
      }
    }
  }
}

function paintLandmarks(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  for (const group of collectBuildings(model)) {
    if (!group.landmark) continue;
    for (const poly of group.polys) {
      parts.push(`<path d="${polygonToPath(poly, shift)}" fill="${theme.landmarkFill}" stroke="${theme.buildingStroke}" stroke-width="${group.strokeWidth.toFixed(2)}"/>`);
    }
  }
}

/** Water-patch edges that belong to exactly one water patch (the coast). */
function outerWaterEdges(model: Model): Array<[Point, Point]> {
  const ids = new Map<Point, number>();
  let nextId = 0;
  const idOf = (p: Point): number => {
    let i = ids.get(p);
    if (i === undefined) { i = nextId++; ids.set(p, i); }
    return i;
  };
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, [Point, Point]>();
  for (const patch of model.waterbody) {
    const vs = patch.shape.vertices;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const ia = idOf(a), ib = idOf(b);
      const key = ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!firstSeen.has(key)) firstSeen.set(key, [a, b]);
    }
  }
  const out: Array<[Point, Point]> = [];
  for (const [key, seg] of firstSeen) {
    if (counts.get(key) === 1) out.push(seg);
  }
  return out;
}

/** Group consecutive active wall segments into polylines. */
function getActiveWallPolylines(wall: CurtainWall): Point[][] {
  const len = wall.shape.length;
  const allActive = wall.segments.every(s => s);

  if (allActive) {
    // Full closed wall — return all vertices plus close back to start
    return [[...wall.shape.vertices, wall.shape.vertices[0]]];
  }

  const polylines: Point[][] = [];
  let current: Point[] | null = null;

  for (let i = 0; i < len; i++) {
    if (wall.segments[i]) {
      if (current === null) {
        current = [wall.shape.vertices[i]];
      }
      current.push(wall.shape.vertices[(i + 1) % len]);
    } else {
      if (current !== null) {
        polylines.push(current);
        current = null;
      }
    }
  }
  if (current !== null) {
    // Check if this run wraps around and connects to the first polyline
    if (polylines.length > 0 && polylines[0][0] === current[current.length - 1]) {
      // Prepend current to the first polyline
      current.pop(); // remove the duplicate connecting vertex
      polylines[0] = [...current, ...polylines[0]];
    } else {
      polylines.push(current);
    }
  }

  return polylines;
}

function renderWall(
  parts: string[],
  wall: CurtainWall,
  large: boolean,
  theme: RenderTheme,
  shift: OriginShift,
): void {
  // Wall outline — draw only active segments as polylines
  const polylines = getActiveWallPolylines(wall);
  for (const polyline of polylines) {
    parts.push(`<path d="${polylineToPath(polyline, shift)}" fill="none" stroke="${theme.buildingStroke}" stroke-width="${THICK_STROKE.toFixed(2)}" stroke-linecap="round"/>`);
  }

  // Gates
  for (const gate of wall.gates) {
    renderGate(parts, wall.shape, gate, theme, shift);
  }

  // Towers
  const r = THICK_STROKE * (large ? 1.5 : 1);
  for (const t of wall.towers) {
    const [cx, cy] = sc(t, shift);
    parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${theme.buildingStroke}"/>`);
  }
}

function renderGate(parts: string[], wall: Polygon, gate: Point, theme: RenderTheme, shift: OriginShift): void {
  const dir = wall.next(gate).subtract(wall.prev(gate));
  dir.normalize(THICK_STROKE * 1.5);
  const p1 = gate.subtract(dir);
  const p2 = gate.add(dir);
  const [x1, y1] = sc(p1, shift);
  const [x2, y2] = sc(p2, shift);
  parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${theme.buildingStroke}" stroke-width="${(THICK_STROKE * 2).toFixed(2)}" stroke-linecap="butt"/>`);
}
