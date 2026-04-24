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
import { PALETTE_DEFAULT } from './palette.js';
import { NO_SHIFT, applyOutputShift, type OriginShift } from '../generator/origin-shift.js';

const NORMAL_STROKE = 0.15;
const THICK_STROKE = 1.8;

function colorToHex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

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
  const palette = options.palette ?? PALETTE_DEFAULT;
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
  parts.push(`<rect data-bg="paper" x="${viewMinX.toFixed(1)}" y="${viewMinY.toFixed(1)}" width="${viewWidth.toFixed(1)}" height="${viewHeight.toFixed(1)}" fill="${colorToHex(palette.paper)}"/>`);

  // Water
  if (model.waterbody.length > 0 && palette.water != null) {
    for (const patch of model.waterbody) {
      parts.push(`<path d="${polygonToPath(patch.shape, shift)}" fill="${colorToHex(palette.water)}" stroke="none"/>`);
    }
  }

  // Roads
  for (const road of model.roads) {
    const path = polylineToPath(road.vertices, shift);
    // Outer stroke
    parts.push(`<path d="${path}" fill="none" stroke="${colorToHex(palette.medium)}" stroke-width="${(2 + NORMAL_STROKE).toFixed(2)}" stroke-linecap="butt"/>`);
    // Inner fill
    parts.push(`<path d="${path}" fill="none" stroke="${colorToHex(palette.paper)}" stroke-width="${(2 - NORMAL_STROKE).toFixed(2)}"/>`);
  }

  // Streets/arteries
  for (const artery of model.arteries) {
    const path = polylineToPath(artery.vertices, shift);
    parts.push(`<path d="${path}" fill="none" stroke="${colorToHex(palette.medium)}" stroke-width="${(2 + NORMAL_STROKE).toFixed(2)}" stroke-linecap="butt"/>`);
    parts.push(`<path d="${path}" fill="none" stroke="${colorToHex(palette.paper)}" stroke-width="${(2 - NORMAL_STROKE).toFixed(2)}"/>`);
  }

  // Patches/buildings
  for (const patch of model.patches) {
    if (!patch.ward || patch.ward.geometry.length === 0) continue;

    const ward = patch.ward;
    const wardType = ward.type;

    switch (wardType) {
      case WardType.Castle:
        // Double render: stroke first, then fill
        for (const block of ward.geometry) {
          parts.push(`<path d="${polygonToPath(block, shift)}" fill="none" stroke="${colorToHex(palette.dark)}" stroke-width="${(NORMAL_STROKE * 4).toFixed(2)}"/>`);
        }
        for (const block of ward.geometry) {
          parts.push(`<path d="${polygonToPath(block, shift)}" fill="${colorToHex(palette.light)}" stroke="none"/>`);
        }
        break;

      case WardType.Cathedral:
        for (const block of ward.geometry) {
          parts.push(`<path d="${polygonToPath(block, shift)}" fill="none" stroke="${colorToHex(palette.dark)}" stroke-width="${(NORMAL_STROKE * 2).toFixed(2)}"/>`);
        }
        for (const block of ward.geometry) {
          parts.push(`<path d="${polygonToPath(block, shift)}" fill="${colorToHex(palette.light)}" stroke="none"/>`);
        }
        break;

      case WardType.Park: {
        const parkColor = palette.green ?? palette.medium;
        for (const grove of ward.geometry) {
          parts.push(`<path d="${polygonToPath(grove, shift)}" fill="${colorToHex(parkColor)}" stroke="none"/>`);
        }
        break;
      }

      case WardType.Harbour:
        // Warehouse buildings
        for (const building of ward.geometry) {
          parts.push(`<path d="${polygonToPath(building, shift)}" fill="${colorToHex(palette.light)}" stroke="${colorToHex(palette.dark)}" stroke-width="${NORMAL_STROKE.toFixed(2)}"/>`);
        }
        // Piers — thicker stroke for dock structures
        if (ward instanceof Harbour) {
          for (const pier of ward.piers) {
            parts.push(`<path d="${polygonToPath(pier, shift)}" fill="${colorToHex(palette.light)}" stroke="${colorToHex(palette.dark)}" stroke-width="${(NORMAL_STROKE * 2).toFixed(2)}"/>`);
          }
        }
        break;

      case WardType.Farm: {
        const farmWard = ward as Farm;
        const greenColor = palette.green ?? palette.medium;

        // Field subplots
        for (const plot of farmWard.subPlots) {
          if (plot.length >= 3) {
            parts.push(`<path d="${polygonToPath(new Polygon(plot), shift)}" fill="${colorToHex(greenColor)}" stroke="none"/>`);
          }
        }

        // Furrow lines within fields
        for (const furrow of farmWard.furrows) {
          const [x1, y1] = sc(furrow.start, shift);
          const [x2, y2] = sc(furrow.end, shift);
          parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${colorToHex(greenColor)}" stroke-width="${NORMAL_STROKE.toFixed(2)}" opacity="0.5"/>`);
        }

        // Farmstead buildings on top
        for (const building of farmWard.buildings) {
          parts.push(`<path d="${polygonToPath(building, shift)}" fill="${colorToHex(palette.light)}" stroke="${colorToHex(palette.dark)}" stroke-width="${NORMAL_STROKE.toFixed(2)}"/>`);
        }
        break;
      }

      default:
        // Craftsmen, Merchant, Slum, Patriciate, Administration, Military, Gate, Market
        for (const building of ward.geometry) {
          parts.push(`<path d="${polygonToPath(building, shift)}" fill="${colorToHex(palette.light)}" stroke="${colorToHex(palette.dark)}" stroke-width="${NORMAL_STROKE.toFixed(2)}"/>`);
        }
        break;
    }
  }

  // Walls
  if (model.wall !== null) {
    renderWall(parts, model.wall, false, palette, shift);
  }
  if (model.citadel !== null && model.citadel.ward instanceof Castle) {
    renderWall(parts, (model.citadel.ward as Castle).wall, true, palette, shift);
  }

  parts.push('</svg>');
  return parts.join('\n');
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
  palette: Palette,
  shift: OriginShift,
): void {
  // Wall outline — draw only active segments as polylines
  const polylines = getActiveWallPolylines(wall);
  for (const polyline of polylines) {
    parts.push(`<path d="${polylineToPath(polyline, shift)}" fill="none" stroke="${colorToHex(palette.dark)}" stroke-width="${THICK_STROKE.toFixed(2)}" stroke-linecap="round"/>`);
  }

  // Gates
  for (const gate of wall.gates) {
    renderGate(parts, wall.shape, gate, palette, shift);
  }

  // Towers
  const r = THICK_STROKE * (large ? 1.5 : 1);
  for (const t of wall.towers) {
    const [cx, cy] = sc(t, shift);
    parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${colorToHex(palette.dark)}"/>`);
  }
}

function renderGate(parts: string[], wall: Polygon, gate: Point, palette: Palette, shift: OriginShift): void {
  const dir = wall.next(gate).subtract(wall.prev(gate));
  dir.normalize(THICK_STROKE * 1.5);
  const p1 = gate.subtract(dir);
  const p2 = gate.add(dir);
  const [x1, y1] = sc(p1, shift);
  const [x2, y2] = sc(p2, shift);
  parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${colorToHex(palette.dark)}" stroke-width="${(THICK_STROKE * 2).toFixed(2)}" stroke-linecap="butt"/>`);
}
